import type { McpServerStatus } from '@shared/events';

// Origen de un servidor MCP tal y como lo ve una sesion (D1 Fase 2): "comun" si su nombre aparece en
// mcp-common.json (se comparte con TODAS las cuentas via --mcp-config), "propio" si no (viene del
// .claude.json/.mcp.json de esta cuenta/proyecto en concreto). Nota: si el MISMO nombre existe en los
// dos sitios con config DISTINTA, gana el comun (verificado en vivo, D1 Fase 1) -- este modulo solo
// puede reportar el nombre que la sesion cargo, no distinguir esa colision desde aqui.
export type McpOrigin = 'comun' | 'propio';

export interface McpServerView extends McpServerStatus {
  readonly origin: McpOrigin;
}

// Etiqueta cada servidor que la sesion cargo DE VERDAD (mcp_servers del evento init) segun si su
// nombre aparece en la lista de servidores comunes (mcp-common.json). PURA: sin FS ni IPC.
export function tagMcpServersByOrigin(
  mcpServers: readonly McpServerStatus[],
  commonServerNames: readonly string[],
): readonly McpServerView[] {
  const commonNames = new Set(commonServerNames);
  return mcpServers.map((server) => ({ ...server, origin: commonNames.has(server.name) ? 'comun' : 'propio' }));
}
