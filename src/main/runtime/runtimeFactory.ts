import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { CustomProvider } from '@shared/providers';
import type { SessionBase } from '../engine/sessionFactory';
import type { KillableChild, KillOutcome } from '../os/processTree';
import type { ResolvedShell } from '../os/shellResolver';
import { HttpChatClient, type TimerDeps } from './chatClient';
import { createRuntimeGate } from './permissionGate';
import { isRuntimePermissionMode, RuntimeSession, type RuntimePermissionMode } from './runtimeSession';
import { buildSystemPrompt } from './systemPrompt';
import { createBashTool } from './tools/bashTool';
import { createEditTool, createWriteTool, type EditToolsFs } from './tools/editTools';
import { createGlobTool, createGrepTool, createReadTool, type ReadToolsFs } from './tools/readTools';
import { ToolRegistry } from './tools/registry';
import type { RuntimeTool } from './tools/types';

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
  readonly fs: ReadToolsFs;
  readonly editFs: EditToolsFs;
  // Shell de `Bash` segun el ajuste del usuario (ficha D4); se resuelve al crear la sesion.
  readonly shell: () => ResolvedShell;
  readonly spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  // Entorno de los comandos, YA saneado con `scrubAgentEnv`.
  readonly commandEnv: () => NodeJS.ProcessEnv;
  readonly killTree: (child: KillableChild) => KillOutcome;
}

interface SessionTools {
  readonly registry: ToolRegistry;
  readonly shell: ResolvedShell;
}

function sessionTools(env: RuntimeEnv, cwd: string): SessionTools {
  const shell = env.shell();
  const readDeps = { fs: env.fs, platform: env.platform };
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
  const client = new HttpChatClient({
    baseUrl: provider.baseUrl,
    apiKey: () => env.apiKeyFor(providerId),
    fetch: env.fetch,
    timers: env.timers,
  });
  return new RuntimeSession({
    sessionId: params.sessionId,
    model: params.model,
    permissionMode: initialMode(params.permissionMode),
    client,
    tools: registry,
    gate: createRuntimeGate({ cwd: params.cwd, extraDirs: [], platform: env.platform }),
    systemPrompt: () =>
      buildSystemPrompt({
        cwd: params.cwd,
        platform: env.platform,
        shellName: shell.name,
        nowIso: new Date(env.now()).toISOString(),
        toolNames: registry.names(),
        projectNotes: null,
      }),
    emit: base.emit,
    now: env.now,
    newId: env.newId,
    toolsEnabled: true,
    ...(base.log === undefined ? {} : { log: base.log }),
  });
}

function initialMode(mode: string | undefined): RuntimePermissionMode {
  if (mode === undefined || mode.length === 0) return 'default';
  if (!isRuntimePermissionMode(mode)) throw new Error(`Modo de permiso invalido para el runtime: ${JSON.stringify(mode)}`);
  return mode;
}
