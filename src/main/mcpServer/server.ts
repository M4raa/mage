import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MageToolHandlers, safeToolResult } from './handlers';
import type { HandlerContext } from './handlers';
import { snapshotScope } from './scope';
import type { ConnectionScope } from './scope';
import * as schemas from './schemas';

export interface MageMcpServerOptions extends Omit<HandlerContext, 'scope'> {
  readonly scope: ConnectionScope;
  readonly transport: Transport;
}
export async function startMageMcpServer(options: MageMcpServerOptions): Promise<McpServer> {
  const server = new McpServer({ name: 'mage', version: String(schemas.MAGE_MCP_CONTRACT_VERSION) });
  const handlers = new MageToolHandlers({ ...options, scope: snapshotScope(options.scope) });
  registerTools(server, handlers);
  await server.connect(options.transport);
  return server;
}
function registerTools(server: McpServer, handlers: MageToolHandlers): void {
  server.registerTool('mage_list_sessions', { inputSchema: schemas.listInputSchema, outputSchema: schemas.listOutputSchema }, (input) => safeToolResult(() => handlers.list(input)));
  server.registerTool('mage_create_session', { inputSchema: schemas.createInputSchema, outputSchema: schemas.createOutputSchema }, (input) => safeToolResult(() => handlers.create(input)));
  server.registerTool('mage_get_status', { inputSchema: schemas.statusInputSchema, outputSchema: schemas.statusOutputSchema }, (input) => safeToolResult(() => handlers.status(input)));
  server.registerTool('mage_read_result', { inputSchema: schemas.readInputSchema, outputSchema: schemas.readOutputSchema }, (input) => safeToolResult(() => handlers.read(input)));
  server.registerTool('mage_send', { inputSchema: schemas.sendInputSchema, outputSchema: schemas.sendOutputSchema }, (input) => safeToolResult(() => handlers.send(input)));
  server.registerTool('mage_cancel', { inputSchema: schemas.cancelInputSchema, outputSchema: schemas.cancelOutputSchema }, (input) => safeToolResult(() => handlers.cancel(input)));
}
