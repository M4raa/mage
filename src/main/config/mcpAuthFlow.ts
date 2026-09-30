import type { McpAuthResult, McpLiveStatus } from '@shared/mcp';
import type { ProbeProcess } from '../engine/modelProbe';
import { closeGracefully, controlResponse, isRecord, statusesOf, type ControlResponse } from './mcpStatusProbe';

// «Autenticar» un MCP que pide OAuth (0.1.1 R2, punto 18), con el CLI de la cuenta y SIN turno de
// modelo. MEDIDO en 2.1.285 (`node spike/init-spike.mjs --mcp-auth plugin:figma:figma`):
//   - `mcp_authenticate {serverName}` contesta en ~6 s con `{authUrl, requiresUserAction,
//     callbackExpected, redirectScheme: 'localhost', callbackPort, state}`. El CLI NO abre el navegador
//     en headless (`skipBrowserOpen`): la URL la abre quien pide. Escucha el callback en
//     `localhost:<callbackPort>` mientras el proceso siga vivo, y al recibirlo guarda el token en el
//     `.credentials.json` de SU config dir (`mcpOAuth["<nombre>|<hash>"]`) y reconecta el servidor.
//   - Conectores de claude.ai: `authUrl` de claude.ai con `callbackExpected: false` (se completa alli).
//   - Sin callback el servidor sigue en `needs-auth`: se pregunta `mcp_status` hasta verlo `connected`.
// El proceso tiene que seguir vivo hasta el callback: por eso aqui el plazo es de minutos, no segundos.
//
// Nunca se emite `authUrl` ni la respuesta cruda: `state`/`client_id` no son secretos, pero no hacen falta.

export interface McpAuthDeps {
  readonly spawnProbe: (configDir: string) => ProbeProcess;
  readonly openUrl: (url: string) => Promise<void>;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly exitGraceMs: number;
}

const INIT_ID = 'mage-mcp-auth-init';
const AUTH_ID = 'mage-mcp-auth';
const STATUS_ID = 'mage-mcp-auth-status';
const CONNECTED = 'connected';
const FAILED = 'failed';

const request = (id: string, body: Record<string, unknown>): string => JSON.stringify({ type: 'control_request', request_id: id, request: body });

interface FlowState {
  settled: boolean;
  exited: boolean;
  buffer: string;
  last: readonly McpLiveStatus[] | null;
  poll: NodeJS.Timeout | null;
}

export function authenticateMcp(deps: McpAuthDeps, configDir: string, serverName: string): Promise<McpAuthResult> {
  if (serverName.trim().length === 0) return Promise.reject(new Error(`authenticateMcp: nombre de servidor vacio (${JSON.stringify(serverName)})`));
  return new Promise((resolve) => {
    const child = deps.spawnProbe(configDir);
    const state: FlowState = { settled: false, exited: false, buffer: '', last: null, poll: null };
    const settle = (result: McpAuthResult): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(deadline);
      if (state.poll !== null) clearTimeout(state.poll);
      resolve(result);
      closeGracefully(child, state, deps.exitGraceMs);
    };
    const deadline = setTimeout(() => settle({ kind: 'timeout', statuses: state.last }), deps.timeoutMs);
    const askStatus = (): void => child.writeLine(request(STATUS_ID, { subtype: 'mcp_status' }));
    const flow: FlowContext = { deps, serverName, state, child, settle, askStatus };
    child.onExit(() => {
      state.exited = true;
      settle({ kind: 'error', message: 'El CLI terminó antes de completar la autenticación.' });
    });
    child.onStdout((chunk) => {
      state.buffer += chunk;
      const parts = state.buffer.split('\n');
      state.buffer = parts.pop() ?? '';
      for (const line of parts) handleLine(flow, line);
    });
    child.writeLine(request(INIT_ID, { subtype: 'initialize' }));
  });
}

interface FlowContext {
  readonly deps: McpAuthDeps;
  readonly serverName: string;
  readonly state: FlowState;
  readonly child: ProbeProcess;
  readonly settle: (result: McpAuthResult) => void;
  readonly askStatus: () => void;
}

function handleLine(flow: FlowContext, line: string): void {
  const response = controlResponse(line);
  if (response === null || flow.state.settled) return;
  if (response.subtype === 'error') return flow.settle({ kind: 'error', message: errorText(response) });
  if (response.id === INIT_ID) return flow.child.writeLine(request(AUTH_ID, { subtype: 'mcp_authenticate', serverName: flow.serverName }));
  if (response.id === AUTH_ID) return void onAuthResponse(flow, response.body);
  if (response.id === STATUS_ID) onStatusResponse(flow, response.body);
}

async function onAuthResponse(flow: FlowContext, body: unknown): Promise<void> {
  const auth = isRecord(body) ? body : {};
  if (typeof auth.authUrl === 'string') {
    try {
      await flow.deps.openUrl(auth.authUrl);
    } catch (err) {
      return flow.settle({ kind: 'error', message: `No se pudo abrir el navegador: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  // Se completa fuera (claude.ai): el CLI no espera nada y el estado se ve al volver a comprobar.
  if (auth.callbackExpected === false && auth.requiresUserAction === true) return flow.settle({ kind: 'opened', statuses: flow.state.last });
  flow.askStatus();
}

function onStatusResponse(flow: FlowContext, body: unknown): void {
  flow.state.last = statusesOf(body);
  const server = rawServer(body, flow.serverName);
  if (server?.status === CONNECTED) return flow.settle({ kind: 'connected', statuses: flow.state.last });
  if (server?.status === FAILED) {
    const detail = typeof server.error === 'string' ? `: ${server.error}` : '';
    return flow.settle({ kind: 'error', message: `El servidor ${flow.serverName} no conectó tras autenticar${detail}` });
  }
  flow.state.poll = setTimeout(flow.askStatus, flow.deps.pollMs);
}

function rawServer(body: unknown, name: string): Record<string, unknown> | null {
  if (!isRecord(body) || !Array.isArray(body.mcpServers)) return null;
  const found: unknown = body.mcpServers.find((server: unknown) => isRecord(server) && server.name === name);
  return isRecord(found) ? found : null;
}

function errorText(response: ControlResponse): string {
  return typeof response.error === 'string' && response.error.length > 0 ? response.error : `El CLI rechazó la petición (${String(response.id)}).`;
}
