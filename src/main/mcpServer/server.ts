import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { registerBrowserTools, type BrowserToolsPort } from './browserTools';
import { MageToolHandlers, safeToolResult } from './handlers';
import type { HandlerContext } from './handlers';
import { snapshotScope } from './scope';
import type { ConnectionScope } from './scope';
import * as schemas from './schemas';

// Lo lee el modelo (U26): castellano, como el resto de lo que le llega de Mage.
export const ASK_CREATOR_DESCRIPTION = 'Pregunta a la sesión que te encargó este trabajo (tu creadora). Devuelve en el acto: no esperes la respuesta ni la consultes; termina tu turno ahora. La respuesta te llegará como tu siguiente mensaje. Solo funciona en una sesión creada con mage_create_session.';

export interface MageMcpServerOptions extends Omit<HandlerContext, 'scope'> {
  readonly scope: ConnectionScope;
  readonly transport: Transport;
  readonly browser?: BrowserToolsPort;
}
export async function startMageMcpServer(options: MageMcpServerOptions): Promise<McpServer> {
  const server = new McpServer({ name: 'mage', version: String(schemas.MAGE_MCP_CONTRACT_VERSION) });
  const { browser, ...context } = options;
  const handlers = new MageToolHandlers({ ...context, scope: snapshotScope(options.scope) });
  registerTools(server, handlers);
  // F11b.2: solo con una sesión de Mage detrás (D-S5); las siete de siempre no cambian.
  if (browser !== undefined) registerBrowserTools(server, browser);
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
  server.registerTool('mage_ask_creator', { description: ASK_CREATOR_DESCRIPTION, inputSchema: schemas.askCreatorInputSchema, outputSchema: schemas.askCreatorOutputSchema }, (input) => safeToolResult(() => handlers.askCreator(input)));
}
