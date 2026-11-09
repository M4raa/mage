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

export const CREATE_SESSION_DESCRIPTION = 'Crea una sesión delegada que trabaja en paralelo y devuelve su conversationId. Por defecto hereda tu modelo, tu esfuerzo y tu modo de permisos. Si eliges otro proveedor (provider), usa el modelo y el esfuerzo por defecto de ese proveedor y el modo equivalente al tuyo o uno más restrictivo. Puedes indicar model, effort y permissionMode; el modo solo puede ser igual o más restrictivo que el tuyo (de más a menos permisivo: bypassPermissions, auto, acceptEdits, default, plan; en Codex :danger-full-access, :workspace, :read-only). Uno más permisivo se rechaza con permission_mode_exceeds_creator. Los permisos de la sesión delegada los aprueba el usuario, no tú.';

// P-038: lo que el modelo lee SIEMPRE (las «instrucciones del servidor» entran en el prompt aunque las herramientas MCP
// vayan diferidas tras ToolSearch). MEDIDO con spike/mage-sessions-e2e.mjs: sin esto, «lanza dos sesiones nuevas» acababa
// en subagentes (Agent) o en `claude -p` desde la consola, aun con el MCP de Mage cargado.
export const SESSIONS_INSTRUCTIONS = [
  'Esta conversación corre dentro de Mage.',
  'Cuando el usuario pida sesiones, conversaciones o chats NUEVOS (o «subsesiones»), créalos con mage_create_session: cada uno es una conversación independiente que el usuario ve como pestaña en Mage. Para eso no uses subagentes (Agent/Task) ni lances el CLI desde la consola (claude -p, codex exec).',
  'Una sesión creada trabaja sola y Mage no te avisa al terminar: consulta mage_get_status hasta que su estado sea done (o waiting_answer si te pregunta algo) y entonces lee su respuesta con mage_read_result. Con mage_send le mandas otro mensaje y con mage_cancel paras su turno. mage_list_sessions lista las que hay.',
].join('\n');

export const BROWSER_INSTRUCTIONS = 'Cuando el usuario hable del navegador de Mage (el navegador integrado o el panel Navegador), usa las herramientas mage_browser_* (navigate, read_dom, click, type, screenshot, back, close): la página se ve en el panel Navegador de esta conversación. No uses otros navegadores (Playwright, Chrome) para eso.';

export const LIST_SESSIONS_DESCRIPTION = 'Lista las sesiones de Mage que puedes ver (por defecto, las que siguen activas; includeFinished: true añade las terminadas) con su conversationId, título, proveedor y estado.';
export const GET_STATUS_DESCRIPTION = 'Estado de una sesión creada con mage_create_session: working, waiting_answer (te ha preguntado algo con mage_ask_creator), permission_pending (espera un permiso del usuario), done o interrupted.';
export const READ_RESULT_DESCRIPTION = 'Lee los mensajes de una sesión (su respuesta incluida). Para leer solo lo nuevo, pasa en afterSeq el nextSeq de la lectura anterior.';
export const SEND_DESCRIPTION = 'Manda otro mensaje a una sesión creada: mode direct entra en el turno en marcha; queue espera a que acabe.';
export const CANCEL_DESCRIPTION = 'Para el turno en marcha de una sesión creada (scope: turn). La sesión sigue existiendo.';

export interface MageMcpServerOptions extends Omit<HandlerContext, 'scope'> {
  readonly scope: ConnectionScope;
  readonly transport: Transport;
  readonly browser?: BrowserToolsPort;
}
export async function startMageMcpServer(options: MageMcpServerOptions): Promise<McpServer> {
  const { browser, ...context } = options;
  const instructions = browser === undefined ? SESSIONS_INSTRUCTIONS : `${SESSIONS_INSTRUCTIONS}\n${BROWSER_INSTRUCTIONS}`;
  const server = new McpServer({ name: 'mage', version: String(schemas.MAGE_MCP_CONTRACT_VERSION) }, { instructions });
  const handlers = new MageToolHandlers({ ...context, scope: snapshotScope(options.scope) });
  registerTools(server, handlers);
  // F11b.2: solo con una sesión de Mage detrás (D-S5); las siete de siempre no cambian.
  if (browser !== undefined) registerBrowserTools(server, browser);
  await server.connect(options.transport);
  return server;
}
function registerTools(server: McpServer, handlers: MageToolHandlers): void {
  server.registerTool('mage_list_sessions', { description: LIST_SESSIONS_DESCRIPTION, inputSchema: schemas.listInputSchema, outputSchema: schemas.listOutputSchema }, (input) => safeToolResult(() => handlers.list(input)));
  server.registerTool('mage_create_session', { description: CREATE_SESSION_DESCRIPTION, inputSchema: schemas.createInputSchema, outputSchema: schemas.createOutputSchema }, (input) => safeToolResult(() => handlers.create(input)));
  server.registerTool('mage_get_status', { description: GET_STATUS_DESCRIPTION, inputSchema: schemas.statusInputSchema, outputSchema: schemas.statusOutputSchema }, (input) => safeToolResult(() => handlers.status(input)));
  server.registerTool('mage_read_result', { description: READ_RESULT_DESCRIPTION, inputSchema: schemas.readInputSchema, outputSchema: schemas.readOutputSchema }, (input) => safeToolResult(() => handlers.read(input)));
  server.registerTool('mage_send', { description: SEND_DESCRIPTION, inputSchema: schemas.sendInputSchema, outputSchema: schemas.sendOutputSchema }, (input) => safeToolResult(() => handlers.send(input)));
  server.registerTool('mage_cancel', { description: CANCEL_DESCRIPTION, inputSchema: schemas.cancelInputSchema, outputSchema: schemas.cancelOutputSchema }, (input) => safeToolResult(() => handlers.cancel(input)));
  server.registerTool('mage_ask_creator', { description: ASK_CREATOR_DESCRIPTION, inputSchema: schemas.askCreatorInputSchema, outputSchema: schemas.askCreatorOutputSchema }, (input) => safeToolResult(() => handlers.askCreator(input)));
}
