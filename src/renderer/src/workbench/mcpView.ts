import type { McpServerStatus } from '@shared/events';
import type { McpAuthResult, McpInventory, McpInventoryRow, McpLiveStatus, McpOriginKind, McpStatusByAccount, McpTransport } from '@shared/mcp';

// Vista PURA de «MCP y conectores» (P-028 punto 5) y del Inspector › MCP: une el inventario de main
// (ficheros) con lo que reportan las sesiones (`mcp_status` o el `session_init`), traduce estados y
// decide insignias. Sin React, sin IPC.

// Nombres con los que el CLI reporta lo que no esta en ningun fichero. MEDIDO en 2.1.284
// (`spike/init-spike.mjs --mcp`): `claude.ai <X>` con scope `claudeai` y `plugin:<plugin>:<servidor>`.
const CONNECTOR_PREFIX = 'claude.ai ';
const PLUGIN_PREFIX = 'plugin:';
const CONNECTOR_SCOPE = 'claudeai';
export const CLAUDE_AI_CONNECTORS_URL = 'https://claude.ai/settings/connectors';
export const NO_STATUS = '—';
export const NEEDS_AUTH = 'needs-auth';

const STATUS_LABELS: Readonly<Record<string, string>> = {
  connected: 'Conectado',
  pending: 'Pendiente',
  'needs-auth': 'Requiere autenticación',
  failed: 'Falló',
  disabled: 'Desactivado',
};

// Estado del CLI en castellano. Uno que no conocemos se enseña tal cual (lo define el CLI y crece).
export function mcpStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export type McpBadgeKind = McpOriginKind | 'connector' | 'plugin' | 'session';

export interface McpBadge {
  readonly kind: McpBadgeKind;
  readonly label: string;
}

export type McpRowKind = 'server' | 'connector' | 'plugin';

export interface McpTableRow {
  readonly key: string;
  readonly name: string;
  readonly kind: McpRowKind;
  readonly typeLabel: string;
  readonly badges: readonly McpBadge[];
  readonly accounts: readonly string[]; // configDir
  readonly statusLabel: string;
  readonly inventory: McpInventoryRow | null;
  // Nombre tal cual lo reporta el CLI (`plugin:figma:figma`): es el que entiende `mcp_authenticate`.
  readonly cliName: string;
  // Cuentas (configDir) cuyo CLI dijo `needs-auth`: una accion «Autenticar» por cada una.
  readonly needsAuth: readonly string[];
}

const TRANSPORT_LABELS: Readonly<Record<McpTransport, string>> = { stdio: 'Local', http: 'Remoto (HTTP)', sse: 'Remoto (SSE)' };

// Estado por cuenta: lo sondeado con `mcp_status` manda; si una cuenta no se sondeo, vale lo que
// reporto el ultimo `session_init` de cualquiera de sus pestañas.
export function mergeLiveStatuses(
  probed: McpStatusByAccount,
  sessions: readonly { readonly accountId: string; readonly servers: readonly McpServerStatus[] }[],
): McpStatusByAccount {
  const merged: Record<string, readonly McpLiveStatus[]> = {};
  for (const session of sessions) {
    if (session.servers.length === 0) continue;
    merged[session.accountId] = session.servers.map((server) => ({ ...server, scope: null }));
  }
  return { ...merged, ...probed };
}

// Filas de la tabla: primero lo que hay en ficheros; despues los conectores de claude.ai y los plugins,
// que solo se conocen por lo que reporta una sesion.
export function buildMcpTable(inventory: McpInventory | null, statuses: McpStatusByAccount): readonly McpTableRow[] {
  const byName = indexStatuses(statuses);
  const rows = (inventory?.rows ?? []).map((row) => serverRow(row, byName.get(row.name) ?? []));
  const known = new Set(rows.map((row) => row.name));
  for (const [name, reports] of byName) {
    if (known.has(name)) continue;
    const extra = sessionOnlyRow(name, reports);
    if (extra !== null) rows.push(extra);
  }
  return rows;
}

interface StatusReport {
  readonly accountId: string;
  readonly status: McpLiveStatus;
}

function indexStatuses(statuses: McpStatusByAccount): Map<string, StatusReport[]> {
  const byName = new Map<string, StatusReport[]>();
  for (const [accountId, list] of Object.entries(statuses)) {
    for (const status of list) byName.set(status.name, [...(byName.get(status.name) ?? []), { accountId, status }]);
  }
  return byName;
}

function serverRow(row: McpInventoryRow, reports: readonly StatusReport[]): McpTableRow {
  return {
    key: `server:${row.name}`,
    name: row.name,
    kind: 'server',
    typeLabel: TRANSPORT_LABELS[row.transport],
    badges: row.origins.map((origin) => ({ kind: origin.kind, label: origin.label })),
    accounts: row.accounts,
    statusLabel: row.disabled ? mcpStatusLabel('disabled') : summarizeStatus(reports),
    inventory: row,
    cliName: row.name,
    needsAuth: row.disabled ? [] : accountsNeedingAuth(reports),
  };
}

function sessionOnlyRow(name: string, reports: readonly StatusReport[]): McpTableRow | null {
  const accounts = [...new Set(reports.map((report) => report.accountId))];
  const statusLabel = summarizeStatus(reports);
  const live = { cliName: name, needsAuth: accountsNeedingAuth(reports) };
  const isConnector = name.startsWith(CONNECTOR_PREFIX) || reports.some((report) => report.status.scope === CONNECTOR_SCOPE);
  if (isConnector) {
    const display = name.startsWith(CONNECTOR_PREFIX) ? name.slice(CONNECTOR_PREFIX.length) : name;
    const badges = [{ kind: 'connector' as const, label: 'claude.ai' }];
    return { key: `connector:${name}`, name: display, kind: 'connector', typeLabel: 'Conector claude.ai', badges, accounts, statusLabel, inventory: null, ...live };
  }
  const plugin = parsePluginServer(name);
  if (plugin !== null) {
    const badges = [{ kind: 'plugin' as const, label: `Plugin ${plugin.plugin}` }];
    return { key: `plugin:${name}`, name: plugin.server, kind: 'plugin', typeLabel: 'Plugin', badges, accounts, statusLabel, inventory: null, ...live };
  }
  // Una sesion lo cargo pero no esta en ninguno de los ficheros leidos (p. ej. el `.mcp.json` de otra
  // carpeta): se enseña igual, con su estado.
  const badges = [{ kind: 'session' as const, label: 'Sesión' }];
  return { key: `session:${name}`, name, kind: 'server', typeLabel: '—', badges, accounts, statusLabel, inventory: null, ...live };
}

function accountsNeedingAuth(reports: readonly StatusReport[]): readonly string[] {
  return [...new Set(reports.filter((report) => report.status.status === NEEDS_AUTH).map((report) => report.accountId))];
}

function parsePluginServer(name: string): { readonly plugin: string; readonly server: string } | null {
  if (!name.startsWith(PLUGIN_PREFIX)) return null;
  const [plugin, ...rest] = name.slice(PLUGIN_PREFIX.length).split(':');
  if (plugin === undefined || plugin.length === 0 || rest.length === 0) return null;
  return { plugin, server: rest.join(':') };
}

// Un estado si todas las cuentas dicen lo mismo; si no, cada uno con cuantas lo dicen.
export function summarizeStatus(reports: readonly { readonly status: McpLiveStatus }[]): string {
  if (reports.length === 0) return NO_STATUS;
  const counts = new Map<string, number>();
  for (const report of reports) {
    const label = mcpStatusLabel(report.status.status);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 1) return [...counts.keys()][0]!;
  return [...counts.entries()].map(([label, count]) => `${label} (${count})`).join(' · ');
}

// Busqueda por nombre, tipo o insignia, sin distinguir mayusculas.
export function filterMcpTable(rows: readonly McpTableRow[], query: string): readonly McpTableRow[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return rows;
  return rows.filter((row) => [row.name, row.typeLabel, ...row.badges.map((badge) => badge.label)].some((text) => text.toLowerCase().includes(needle)));
}

// --- Inspector › MCP (lo que cargo UNA sesion) ------------------------------------------------

export interface McpSessionServerView extends McpServerStatus {
  readonly badge: McpBadge;
  readonly statusLabel: string;
}

// Insignia de un servidor que la sesion cargo DE VERDAD, por su nombre: comun si esta en mcp-common.json
// (si el mismo nombre existe tambien en la cuenta con otra config, gana el comun, verificado en D1), y
// los conectores y plugins por su prefijo medido.
export function tagSessionServers(servers: readonly McpServerStatus[], commonNames: readonly string[]): readonly McpSessionServerView[] {
  const common = new Set(commonNames);
  return servers.map((server) => ({ ...server, badge: sessionBadge(server.name, common), statusLabel: mcpStatusLabel(server.status) }));
}

function sessionBadge(name: string, common: ReadonlySet<string>): McpBadge {
  if (common.has(name)) return { kind: 'common', label: 'Mage' };
  if (name.startsWith(CONNECTOR_PREFIX)) return { kind: 'connector', label: 'claude.ai' };
  const plugin = parsePluginServer(name);
  if (plugin !== null) return { kind: 'plugin', label: `Plugin ${plugin.plugin}` };
  return { kind: 'account', label: 'Cuenta o proyecto' };
}

// --- «Autenticar» (punto 18) ----------------------------------------------------------------

export interface McpAuthMessage {
  readonly ok: boolean;
  readonly text: string;
}

// Lo que se enseña bajo el boton al terminar. Todo desenlace se dice: nunca se queda en silencio.
export function mcpAuthMessage(result: McpAuthResult): McpAuthMessage {
  switch (result.kind) {
    case 'connected':
      return { ok: true, text: 'Autenticado y conectado. Las conversaciones nuevas ya lo cargan.' };
    case 'opened':
      return { ok: true, text: 'Termina la autorización en el navegador y pulsa «Comprobar estado».' };
    case 'timeout':
      return { ok: false, text: 'No se completó la autorización en el navegador a tiempo (5 min). Vuelve a intentarlo.' };
    case 'error':
      return { ok: false, text: result.message };
  }
}

export const mcpAuthKey = (accountDir: string, serverName: string): string => `${accountDir}
${serverName}`;
