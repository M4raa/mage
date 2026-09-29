import type { McpLiveStatus } from '@shared/mcp';
import type { ProbeProcess } from '../engine/modelProbe';

// Estado de los servidores MCP de una cuenta SIN gastar un turno (P-028 punto 5). MEDIDO en 2.1.284
// (`node spike/init-spike.mjs --mcp`): tras `initialize`, `mcp_status` contesta en ~2,3 s con
// `{mcpServers: [{name, status, scope, config, ...}]}`, incluidos los plugins (`plugin:<p>:<s>`,
// scope `dynamic`) y los conectores de claude.ai (`claude.ai <X>`, scope `claudeai`). Los recien
// arrancados salen `pending`, asi que se vuelve a preguntar hasta que ninguno lo este o venza el plazo.
//
// De la respuesta se queda SOLO nombre, estado y scope: `config` lleva los `env`/`headers` y no sale de
// aqui. Nunca se manda un mensaje de usuario.

export interface McpStatusProbeDeps {
  readonly spawnProbe: (configDir: string) => ProbeProcess;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly exitGraceMs: number;
}

const INIT_ID = 'mage-mcp-init';
const STATUS_ID = 'mage-mcp-status';
const PENDING = 'pending';

const request = (id: string, subtype: string): string => JSON.stringify({ type: 'control_request', request_id: id, request: { subtype } });

// Lo que contesto la cuenta, o null si no contesto (plazo sin ninguna respuesta, CLI caido, error).
// Si vence el plazo con alguno aun `pending`, devuelve la ultima respuesta: es un dato real.
export function probeMcpStatus(deps: McpStatusProbeDeps, configDir: string): Promise<readonly McpLiveStatus[] | null> {
  return new Promise((resolve) => {
    const child = deps.spawnProbe(configDir);
    const state = { settled: false, exited: false, buffer: '', last: null as readonly McpLiveStatus[] | null, poll: null as NodeJS.Timeout | null };
    const settle = (value: readonly McpLiveStatus[] | null): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(deadline);
      if (state.poll !== null) clearTimeout(state.poll);
      resolve(value);
      closeGracefully(child, state, deps.exitGraceMs);
    };
    const deadline = setTimeout(() => settle(state.last), deps.timeoutMs);
    child.onExit(() => {
      state.exited = true;
      settle(state.last);
    });
    child.onStdout((chunk) => {
      state.buffer += chunk;
      const parts = state.buffer.split('\n');
      state.buffer = parts.pop() ?? '';
      for (const line of parts) handleLine(line);
    });
    const handleLine = (line: string): void => {
      const response = controlResponse(line);
      if (response === null) return;
      if (response.subtype === 'error') return settle(state.last);
      if (response.id === INIT_ID) return void child.writeLine(request(STATUS_ID, 'mcp_status'));
      if (response.id !== STATUS_ID) return;
      state.last = statusesOf(response.body);
      if (!state.last.some((s) => s.status === PENDING)) return settle(state.last);
      state.poll = setTimeout(() => child.writeLine(request(STATUS_ID, 'mcp_status')), deps.pollMs);
    };
    child.writeLine(request(INIT_ID, 'initialize'));
  });
}

// Varias cuentas EN SERIE (cada sondeo es un CLI entero con todos sus MCP arrancando).
export async function probeMcpStatuses(deps: McpStatusProbeDeps, configDirs: readonly string[]): Promise<Record<string, readonly McpLiveStatus[]>> {
  const result: Record<string, readonly McpLiveStatus[]> = {};
  for (const configDir of configDirs) {
    const statuses = await probeMcpStatus(deps, configDir);
    if (statuses !== null) result[configDir] = statuses;
  }
  return result;
}

export interface ControlResponse {
  readonly id: unknown;
  readonly subtype: unknown;
  readonly body: unknown;
  readonly error: unknown; // texto del CLI cuando `subtype === 'error'`
}

export function controlResponse(line: string): ControlResponse | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    // Una linea que no es JSON (aviso de un hook) no es nuestra respuesta: se sigue leyendo.
    return null;
  }
  if (!isRecord(raw) || raw.type !== 'control_response' || !isRecord(raw.response)) return null;
  return { id: raw.response.request_id, subtype: raw.response.subtype, body: raw.response.response, error: raw.response.error };
}

// Parseo tolerante en la frontera: una entrada sin nombre o estado de texto se descarta.
export function statusesOf(body: unknown): readonly McpLiveStatus[] {
  if (!isRecord(body) || !Array.isArray(body.mcpServers)) return [];
  return body.mcpServers.flatMap((server): McpLiveStatus[] => {
    if (!isRecord(server) || typeof server.name !== 'string' || typeof server.status !== 'string') return [];
    return [{ name: server.name, status: server.status, scope: typeof server.scope === 'string' ? server.scope : null }];
  });
}

export function closeGracefully(child: ProbeProcess, state: { readonly exited: boolean }, graceMs: number): void {
  if (state.exited) return;
  child.endInput();
  setTimeout(() => {
    if (!state.exited) child.killTree();
  }, graceMs);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
