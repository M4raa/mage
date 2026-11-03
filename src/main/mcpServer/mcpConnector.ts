import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConnector } from '../host/hostConnection';
import { ExternalSessionsPort } from './hostSessionsPort';
import type { IdempotencyStore } from './idempotencyStore';
import type { ConnectionScope } from './scope';
import { startMageMcpServer } from './server';
import type { MageSessionsPort } from './sessionsPort';
import { TunnelTransport } from './tunnelTransport';

// El servidor MCP de Mage de UNA conexión `mcp` del host (D-M5): con la sesión que la lanzó (credencial MCP_CALLER)
// trabaja sobre sus delegadas; sin ella (M-U2), sus herramientas se rechazan.
export interface McpConnectorDeps {
  readonly resolveCaller: (credential: string | null) => string | null;
  readonly createPort: (callerSessionId: string) => { readonly port: MageSessionsPort; readonly conversationId: string } | null;
  readonly creatorChainOf: (conversationId: string) => readonly string[];
  readonly accountIds: () => readonly string[];
  readonly maxDepth: () => number;
  // UNO de main (D-M11): la idempotencia vale entre conexiones.
  readonly store: IdempotencyStore;
  readonly now: () => string;
  readonly log: (level: 'info' | 'warn', message: string, data?: unknown) => void;
}

interface Binding { readonly port: MageSessionsPort; readonly scope: ConnectionScope }

export function createMcpConnector(deps: McpConnectorDeps): McpConnector {
  return {
    open({ callerCredential, send }) {
      const transport = new TunnelTransport(send);
      const { port, scope } = bindingFor(deps, callerCredential);
      let server: McpServer | null = null;
      let closed = false;
      startMageMcpServer({ port, scope, store: deps.store, now: deps.now, maxDepth: deps.maxDepth(), transport })
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
  if (created === null) {
    deps.log('info', 'Cliente MCP sin sesión de Mage: sus herramientas se rechazan');
    return { port: new ExternalSessionsPort(), scope: { accountIds } };
  }
  return { port: created.port, scope: { accountIds, caller: { conversationId: created.conversationId, creatorChain: deps.creatorChainOf(created.conversationId) } } };
}
