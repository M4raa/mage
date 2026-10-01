import type { ProbeProcess } from '../engine/modelProbe';

// CLI FALSO para `verify:gui` (0.1.1 R2, punto 18), activo solo con MAGE_MCP_FAKE_CLI=1 (mismo patron
// que MAGE_MCP_FAKE_SOURCES). Contesta en proceso, sin spawnear nada, lo medido en 2.1.285: un servidor
// `vg-auth` en `needs-auth` hasta que se pide `mcp_authenticate`; entonces devuelve una `authUrl` falsa y
// «recibe el callback» a los FAKE_CALLBACK_MS. Nunca hay OAuth real ni navegador.

export const FAKE_AUTH_SERVER = 'vg-auth';
export const FAKE_AUTH_URL = 'https://vg.invalid/oauth/mcp';
// Un conector de claude.ai falso en `needs-auth` (pestaña Conectores), con el nombre y el scope medidos.
export const FAKE_CONNECTOR = 'claude.ai VG Conector';
const FAKE_CALLBACK_MS = 1_500;

// Cuentas (configDir) que ya «completaron» el OAuth, para que un «Comprobar estado» posterior lo vea.
const authenticated = new Set<string>();

export function spawnFakeMcpCli(configDir: string): ProbeProcess {
  let stdout: (chunk: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  const reply = (requestId: string, response: unknown): void =>
    queueMicrotask(() => stdout(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`));
  const answer = (requestId: string, subtype: string): void => {
    if (subtype === 'mcp_status') {
      const status = authenticated.has(configDir) ? 'connected' : 'needs-auth';
      return reply(requestId, {
        mcpServers: [
          { name: FAKE_AUTH_SERVER, status, scope: 'user' },
          { name: FAKE_CONNECTOR, status: 'needs-auth', scope: 'claudeai' },
        ],
      });
    }
    if (subtype === 'mcp_authenticate') {
      setTimeout(() => authenticated.add(configDir), FAKE_CALLBACK_MS);
      return reply(requestId, { authUrl: FAKE_AUTH_URL, requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', callbackPort: 1 });
    }
    reply(requestId, {});
  };
  return {
    onStdout: (listener) => {
      stdout = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
    writeLine: (line) => {
      const { request_id, request } = JSON.parse(line) as { request_id: string; request: { subtype: string } };
      answer(request_id, request.subtype);
    },
    endInput: () => exit(),
    killTree: () => exit(),
  };
}
