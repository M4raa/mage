import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { join } from 'node:path';
import type { CustomProvider } from '@shared/providers';
import type { SessionBase } from '../engine/sessionFactory';
import type { KillableChild, KillOutcome } from '../os/processTree';
import type { ResolvedShell } from '../os/shellResolver';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';
import { HttpChatClient, type TimerDeps } from './chatClient';
import { createRuntimeGate } from './permissionGate';
import { isRuntimePermissionMode, RuntimeSession, type PreparedModel, type RuntimePermissionMode } from './runtimeSession';
import { buildSystemPrompt, trimProjectNotes } from './systemPrompt';
import { textToolInstructions } from './textToolCalls';
import { CHARS_PER_TOKEN, ContextBudget } from './contextBudget';
import type { ModelCatalog } from './modelCatalog';
import type { ToolAccessRule } from '@shared/toolAccess';
import type { ResolvedMcpServer } from '../config/mcpResolved';
import { McpPool, type McpConnector } from './mcp/mcpPool';
import { AccessFilteredTools } from './tools/accessFilter';
import { createBashTool } from './tools/bashTool';
import { createEditTool, createWriteTool, type EditToolsFs } from './tools/editTools';
import { createGlobTool, createGrepTool, createReadTool, type ReadToolsFs } from './tools/readTools';
import { ToolRegistry } from './tools/registry';
import type { RuntimeTool } from './tools/types';
import { transcriptToMessages, type ResumedTranscript } from './transcriptToMessages';
import { TranscriptWriter } from './transcriptWriter';

// Monta una `RuntimeSession` para un proveedor del usuario a partir de lo que vive en main (ajustes,
// boveda, red, disco, procesos). Todo entra por `RuntimeEnv`: index.ts solo cablea.

export interface RuntimeEnv {
  readonly findProvider: (providerId: string) => CustomProvider | null;
  // Clave de la boveda, en el momento de cada peticion. null = sin clave.
  readonly apiKeyFor: (providerId: string) => string | null;
  readonly fetch: typeof fetch;
  readonly timers: TimerDeps;
  readonly now: () => number;
  readonly newId: () => string;
  readonly platform: string;
  // Ruta real (sigue symlinks y junctions) o null si no existe: la puerta y Glob/Grep clasifican con ella.
  readonly realpath: (path: string) => string | null;
  readonly fs: ReadToolsFs;
  readonly editFs: EditToolsFs;
  // Shell de `Bash` segun el ajuste del usuario (ficha D4); se resuelve al crear la sesion.
  readonly shell: () => ResolvedShell;
  readonly spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  // Entorno de los comandos, YA saneado con `scrubAgentEnv`.
  readonly commandEnv: () => NodeJS.ProcessEnv;
  readonly killTree: (child: KillableChild) => KillOutcome;
  // Raiz de las transcripciones del runtime (`userData/runtime`, ficha D3) y su E/S sincrona: una linea
  // por evento, en orden.
  readonly transcriptRoot: string;
  readonly appendLine: (path: string, line: string) => void;
  readonly mkdir: (path: string) => void;
  // Texto de un fichero, o null si no existe.
  readonly readText: (path: string) => string | null;
  // Ventana y herramientas de cada modelo (compartido entre sesiones: tiene cache).
  readonly catalog: ModelCatalog;
  // Conector MCP real (SDK, boveda, navegador) para los servidores de una sesion con este cwd (R8).
  readonly mcpConnector: (cwd: string) => McpConnector;
  // Reglas de acceso a herramientas por modelo de un proveedor (§8.1 D10), leidas en cada turno.
  readonly toolAccess: (providerId: string) => readonly ToolAccessRule[];
}

// Notas del proyecto en el prompt de sistema (ficha D16): el PRIMERO que exista, recortado.
const PROJECT_NOTES_FILES = ['AGENTS.md', 'CLAUDE.md'];
export const PROJECT_NOTES_MAX_TOKENS = 1_000;

interface SessionTools {
  readonly registry: ToolRegistry;
  readonly shell: ResolvedShell;
}

function sessionTools(env: RuntimeEnv, cwd: string): SessionTools {
  const shell = env.shell();
  const readDeps = { fs: env.fs, platform: env.platform, realpath: env.realpath };
  const editDeps = { fs: env.editFs, platform: env.platform };
  const tools = [
    createReadTool(readDeps),
    createGlobTool(readDeps),
    createGrepTool(readDeps),
    createWriteTool(editDeps),
    createEditTool(editDeps),
    createBashTool({ shell, spawn: env.spawn, env: env.commandEnv, killTree: env.killTree }),
  ] as unknown as RuntimeTool[];
  return { registry: new ToolRegistry(tools, (signal) => ({ cwd, extraDirs: [], signal })), shell };
}

export function buildRuntimeSession(providerId: string, base: SessionBase, env: RuntimeEnv): RuntimeSession {
  const provider = env.findProvider(providerId);
  if (provider === null) throw new Error(`Proveedor no configurado: ${JSON.stringify(providerId)}. Añádelo en Configuración > Proveedores.`);
  const { params } = base;
  const { registry, shell } = sessionTools(env, params.cwd);
  const projectNotes = readProjectNotes(env, params.cwd);
  const resumed = params.resume === true ? resumeHistory(params, env, base) : null;
  let session: RuntimeSession | null = null;
  const recorder = new TranscriptWriter(
    params.sessionId,
    {
      root: env.transcriptRoot,
      cwd: params.cwd,
      // El modelo de la linea `assistant` sigue al de la sesion si el usuario lo cambia en caliente.
      model: () => session?.currentModel ?? params.model,
      mkdir: env.mkdir,
      appendLine: env.appendLine,
      now: env.now,
      newId: env.newId,
      ...(base.log === undefined ? {} : { log: base.log }),
    },
    resumed?.lastUuid ?? null,
  );
  const client = new HttpChatClient({
    baseUrl: provider.baseUrl,
    apiKey: () => env.apiKeyFor(providerId),
    fetch: env.fetch,
    timers: env.timers,
  });
  const pool = createPool(params.shared?.mcpServers ?? [], params.cwd, env, base, () => session, registry);
  const tools = new AccessFilteredTools(registry, () => env.toolAccess(providerId), () => session?.currentModel ?? params.model);
  session = new RuntimeSession({
    sessionId: params.sessionId,
    model: params.model,
    permissionMode: initialMode(params.permissionMode),
    client,
    tools,
    gate: createRuntimeGate({ cwd: params.cwd, extraDirs: [], platform: env.platform, realpath: env.realpath }),
    systemPrompt: (toolsEnabled) =>
      buildSystemPrompt({
        cwd: params.cwd,
        platform: env.platform,
        shellName: shell.name,
        nowIso: new Date(env.now()).toISOString(),
        toolNames: toolsEnabled ? tools.names() : [],
        textToolGuide: toolsEnabled ? null : textToolInstructions(tools.specs().map((spec) => spec.function)),
        projectNotes,
      }),
    emit: base.emit,
    now: env.now,
    newId: env.newId,
    toolsEnabled: true,
    recorder,
    prepareModel: (model) => prepareModel(providerId, model, env),
    ...(pool === null ? {} : { mcp: { ready: pool.start(), statuses: () => pool.statuses(), close: () => pool.close() } }),
    ...(resumed === null ? {} : { history: resumed.messages }),
    ...(base.log === undefined ? {} : { log: base.log }),
  });
  return session;
}

// Reanudar: los mensajes de la transcripcion propia (P-032 R4). Sin fichero, la conversacion empieza
// vacia con un aviso en el log (no hay de donde sacar el contexto).
function resumeHistory(params: SessionBase['params'], env: RuntimeEnv, base: SessionBase): ResumedTranscript | null {
  const path = resolveTranscriptPath(env.transcriptRoot, params.cwd, params.sessionId);
  const text = env.readText(path);
  if (text === null) {
    base.log?.('warn', 'Reanudar sin transcripcion del runtime: se empieza vacia', { sessionId: params.sessionId });
    return null;
  }
  const resumed = transcriptToMessages(text.split(/\r?\n/));
  for (const warning of resumed.warnings) base.log?.('warn', warning, { sessionId: params.sessionId });
  return resumed;
}

// Los MCP comunes de la sesion (ya filtrados para la familia `local` por `loadSharedLaunch`). Al
// conectar, sus herramientas entran en el registro y la sesion se vuelve a anunciar.
function createPool(
  servers: readonly ResolvedMcpServer[],
  cwd: string,
  env: RuntimeEnv,
  base: SessionBase,
  session: () => RuntimeSession | null,
  registry: ToolRegistry,
): McpPool | null {
  if (servers.length === 0) return null;
  const pool: McpPool = new McpPool(servers, {
    connect: env.mcpConnector(cwd),
    notify: (text) => session()?.notice(text),
    onChange: () => {
      const skipped = registry.add(pool.tools());
      if (skipped.length > 0) base.log?.('info', 'Herramientas MCP ya registradas (se omiten)', { skipped });
      session()?.announce();
    },
    ...(base.log === undefined ? {} : { log: base.log }),
  });
  return pool;
}

// Lo que el catalogo sabe del modelo, con el proveedor RELEIDO (el usuario puede haber fijado la ventana
// entre una conversacion y otra).
async function prepareModel(providerId: string, model: string, env: RuntimeEnv): Promise<PreparedModel> {
  const provider = env.findProvider(providerId);
  if (provider === null) throw new Error(`Proveedor no configurado: ${JSON.stringify(providerId)}`);
  const info = await env.catalog.info(
    {
      id: provider.id,
      baseUrl: provider.baseUrl,
      apiKey: env.apiKeyFor(providerId),
      ...(provider.contextWindow === undefined ? {} : { contextWindow: provider.contextWindow }),
      ...(provider.supportsTools === undefined ? {} : { supportsTools: provider.supportsTools }),
    },
    model,
  );
  return { budget: new ContextBudget(info.contextWindow, model), supportsTools: info.supportsTools, warning: info.warning };
}

function readProjectNotes(env: RuntimeEnv, cwd: string): { readonly file: string; readonly text: string } | null {
  for (const file of PROJECT_NOTES_FILES) {
    const text = env.readText(join(cwd, file));
    if (text !== null && text.trim().length > 0) return { file, text: trimProjectNotes(text, PROJECT_NOTES_MAX_TOKENS * CHARS_PER_TOKEN) };
  }
  return null;
}

function initialMode(mode: string | undefined): RuntimePermissionMode {
  if (mode === undefined || mode.length === 0) return 'default';
  if (!isRuntimePermissionMode(mode)) throw new Error(`Modo de permiso invalido para el runtime: ${JSON.stringify(mode)}`);
  return mode;
}
