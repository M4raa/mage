import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConnector } from '../host/hostConnection';
import { ExternalSessionsPort } from './hostSessionsPort';
import type { IdempotencyStore } from './idempotencyStore';
import type { ConnectionScope } from './scope';
import { startMageMcpServer } from './server';
import type { BrowserToolsPort } from './browserTools';
import type { MageSessionsPort } from './sessionsPort';
import { TunnelTransport } from './tunnelTransport';

// El servidor MCP de Mage de UNA conexión `mcp` del host (D-M5): con la sesión que la lanzó (credencial MCP_CALLER)
// trabaja sobre sus delegadas; sin ella (M-U2), sus herramientas se rechazan.
export interface McpConnectorDeps {
  readonly resolveCaller: (credential: string | null) => string | null;
  readonly createPort: (callerSessionId: string) => { readonly port: MageSessionsPort; readonly conversationId: string } | null;
  // El navegador de la sesión que llama (F11b.2); sin él, las `mage_browser_*` no se registran.
  readonly browserFor?: (callerSessionId: string) => BrowserToolsPort;
  readonly creatorChainOf: (conversationId: string) => readonly string[];
  readonly accountIds: () => readonly string[];
  readonly maxDepth: () => number;
  // UNO de main (D-M11): la idempotencia vale entre conexiones.
  readonly store: IdempotencyStore;
  readonly now: () => string;
  readonly log: (level: 'info' | 'warn', message: string, data?: unknown) => void;
}

// Apagadas en esta versión: en la app real el clic, la escritura y la captura del agente no hacen efecto. El código
// se queda para arreglarlas; mientras, ninguna conexión recibe el navegador y el servidor expone solo las siete de sesiones.
export const AGENT_BROWSER_TOOLS_ENABLED = false;

interface Binding { readonly port: MageSessionsPort; readonly scope: ConnectionScope; readonly browser: BrowserToolsPort | undefined }

export function createMcpConnector(deps: McpConnectorDeps): McpConnector {
  return {
    open({ callerCredential, send }) {
      const transport = new TunnelTransport(send);
      const { port, scope, browser } = bindingFor(deps, callerCredential);
      let server: McpServer | null = null;
      let closed = false;
      startMageMcpServer({ port, scope, store: deps.store, now: deps.now, maxDepth: deps.maxDepth(), transport, browser })
        .then((started) => {
          server = started;
          if (closed) void started.close();
        })
        .catch((err: unknown) => deps.log('warn', 'No se pudo arrancar el servidor MCP de la conexión', { error: err instanceof Error ? err.message : String(err) }));
      return {
        receive: (message) => transport.receive(message),
        close: () => {
          closed = true;
          void server?.close();
          void transport.close();
        },
      };
    },
  };
}

function bindingFor(deps: McpConnectorDeps, credential: string | null): Binding {
  const accountIds = deps.accountIds();
  const callerSessionId = deps.resolveCaller(credential);
  const created = callerSessionId === null ? null : deps.createPort(callerSessionId);
  if (callerSessionId === null || created === null) {
    deps.log('info', 'Cliente MCP sin sesión de Mage: sus herramientas se rechazan');
    return { port: new ExternalSessionsPort(), scope: { accountIds }, browser: undefined };
  }
  return { port: created.port, scope: { accountIds, caller: { conversationId: created.conversationId, creatorChain: deps.creatorChainOf(created.conversationId) } }, browser: AGENT_BROWSER_TOOLS_ENABLED ? deps.browserFor?.(callerSessionId) : undefined };
}
