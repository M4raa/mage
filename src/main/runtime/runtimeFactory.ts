import type { CustomProvider } from '@shared/providers';
import type { SessionBase } from '../engine/sessionFactory';
import { HttpChatClient, type TimerDeps } from './chatClient';
import { isRuntimePermissionMode, RuntimeSession, type GateVerdict, type RuntimePermissionMode } from './runtimeSession';
import { buildSystemPrompt } from './systemPrompt';
import { createGlobTool, createGrepTool, createReadTool, type ReadToolsFs } from './tools/readTools';
import { ToolRegistry } from './tools/registry';
import type { RuntimeTool } from './tools/types';

// Monta una `RuntimeSession` para un proveedor del usuario a partir de lo que vive en main (ajustes,
// boveda, red). Todo entra por `RuntimeEnv`: index.ts solo cablea.

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
}

// Las herramientas de una sesion. Hoy solo lectura, que la tabla de permisos deja pasar en todos los
// modos (R2); la escritura y los comandos llegan con los permisos (R3).
function sessionTools(env: RuntimeEnv, cwd: string): ToolRegistry {
  const deps = { fs: env.fs, platform: env.platform };
  const tools = [createReadTool(deps), createGlobTool(deps), createGrepTool(deps)] as unknown as RuntimeTool[];
  return new ToolRegistry(tools, (signal) => ({ cwd, extraDirs: [], signal }));
}

const ALLOW_ALL = (): GateVerdict => ({ verdict: 'allow' });

export function buildRuntimeSession(providerId: string, base: SessionBase, env: RuntimeEnv): RuntimeSession {
  const provider = env.findProvider(providerId);
  if (provider === null) throw new Error(`Proveedor no configurado: ${JSON.stringify(providerId)}. Añádelo en Configuración > Proveedores.`);
  const { params } = base;
  const tools = sessionTools(env, params.cwd);
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
    tools,
    gate: ALLOW_ALL,
    systemPrompt: () =>
      buildSystemPrompt({ cwd: params.cwd, platform: env.platform, shellName: null, nowIso: new Date(env.now()).toISOString(), toolNames: tools.names(), projectNotes: null }),
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
