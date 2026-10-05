// Modelo COMPARTIDO (main + renderer) de los servidores MCP que ve Mage (P-028, puntos 5 y 34).
//
// Regla de seguridad que da forma a todo el fichero (§0.9 del plan): los VALORES de `env` y `headers`
// de un servidor MCP (tokens, claves) nunca cruzan el IPC hacia el renderer. Viajan sus NOMBRES de
// clave; el valor solo llega al renderer cuando el usuario pulsa «mostrar» sobre un comun de Mage
// (`McpCommonReveal`). Por eso el borrador del editor representa un valor guardado que no se ha
// revelado como `null` («se conserva el que hay»), y es main quien lo resuelve al guardar.

export type McpTransport = 'stdio' | 'http' | 'sse';

// Donde esta declarado un servidor. `common` es el unico que Mage escribe (`mcp-common.json`); el
// resto se lee y nunca se toca.
export type McpOriginKind =
  | 'common' // mcp-common.json de Mage (--mcp-config en todas las cuentas)
  | 'account' // mcpServers de la raiz del .claude.json de una cuenta (ambito usuario)
  | 'projectLocal' // projects[<ruta>].mcpServers del .claude.json de una cuenta (ambito local)
  | 'project' // <carpeta>/.mcp.json (ambito proyecto, versionado)
  | 'legacy' // ~/.claude/mcp-shared.json del script de PowerShell (solo importacion)
  | 'desktop' // mcpServers de claude_desktop_config.json (Claude Desktop)
  | 'agy' // mcp_config.json de agy (lo suyo; lo que exporto Mage se marca aparte)
  | 'codex'; // config.toml de codex, leido con `codex mcp list --json`

export interface McpOrigin {
  readonly kind: McpOriginKind;
  // Texto corto para la insignia: «Mage», «Cuenta claude-p», «Proyecto mage»…
  readonly label: string;
  // Fichero donde vive la declaracion (para «Ver ubicacion»). Una ruta, nunca contenido.
  readonly path: string;
  readonly accountDir: string | null;
  readonly projectDir: string | null;
  // Id estable para «Copiar a comunes» / importar: main lo recalcula al aplicar, el renderer solo lo
  // devuelve tal cual.
  readonly importId: string;
}

// Lo NO secreto de un comun, para abrir el editor: comando, argumentos y URL se enseñan; de `env` y
// `headers` solo los nombres de clave.
export interface McpCommonView {
  readonly transport: McpTransport;
  readonly command: string;
  readonly args: readonly string[];
  readonly url: string;
}

export interface McpInventoryRow {
  readonly name: string;
  readonly transport: McpTransport;
  readonly origins: readonly McpOrigin[];
  // configDir de las cuentas de Claude cuyas sesiones cargan este servidor (vacio: ninguna, p. ej. uno
  // que solo esta en Claude Desktop).
  readonly accounts: readonly string[];
  readonly envKeys: readonly string[];
  readonly headerKeys: readonly string[];
  // Solo comunes: desactivado = fuera del --mcp-config sin borrarlo.
  readonly disabled: boolean;
  readonly common: McpCommonView | null;
  // Familias de proveedor que lo cargan (pastillas de la columna «Proveedores»).
  readonly providers: readonly McpProviderFamily[];
  // Solo lo carga el CLI de esa familia (insignia «Solo Claude / Codex / agy»). null = es de Mage o de
  // ninguno (Claude Desktop).
  readonly ownedBy: McpProviderFamily | null;
  // Solo comunes: «Solo en…» (null = todos los compatibles).
  readonly onlyIn: McpScope;
  // Solo comunes: exportado a agy por «Sincronizar con agy» (copia, puede estar desfasada).
  readonly exportedToAgy: boolean;
}

// Cuentas con MCP de ambito usuario que no estan en los comunes (aviso de Ajustes, punto 34).
export interface McpUnsharedAccount {
  readonly accountDir: string;
  readonly names: readonly string[];
}

export interface McpInventory {
  readonly rows: readonly McpInventoryRow[];
  readonly unshared: readonly McpUnsharedAccount[];
  // Huella del mcp-common.json leido (null = no existe). Es la base del compare-and-swap: el renderer
  // no puede recibir los bytes (llevan los `env`), asi que devuelve esta huella al guardar.
  readonly commonVersion: string | null;
  // Ficheros que no se pudieron interpretar (sin contenido: solo que fichero y por que).
  readonly warnings: readonly string[];
}

export interface McpInventoryParams {
  // Carpetas cuyo `.mcp.json` se lee (la de la pestaña activa).
  readonly projectDirs: readonly string[];
}

// --- Importacion (punto 34) ----------------------------------------------------------------------

export type McpImportGroup = 'desktop' | 'cli';
export type McpImportStatus = 'new' | 'same' | 'different';

export interface McpImportCandidate {
  readonly id: string;
  readonly name: string;
  readonly group: McpImportGroup;
  readonly originLabel: string;
  readonly transport: McpTransport;
  readonly status: McpImportStatus;
  readonly checkedByDefault: boolean;
  readonly note: string | null;
}

export interface McpImportPreview {
  readonly candidates: readonly McpImportCandidate[];
  readonly commonVersion: string | null;
}

export interface McpImportPick {
  readonly id: string;
  // Solo cuenta si ya existe un comun con ese nombre: `true` lo sustituye, `false` se queda el actual.
  readonly replace: boolean;
}

export interface McpImportApplyParams {
  readonly picks: readonly McpImportPick[];
  readonly expected: string | null;
  readonly projectDirs: readonly string[];
}

// --- Edicion de comunes ------------------------------------------------------------------------

// Una variable o cabecera en el editor. `value === null`: hay un valor guardado que no se ha revelado
// y se conserva tal cual (lo resuelve main).
export interface McpKeyValueDraft {
  readonly key: string;
  readonly value: string | null;
}

export interface McpServerDraft {
  readonly name: string;
  readonly transport: McpTransport;
  readonly command: string;
  readonly argsText: string; // un argumento por linea: aguanta rutas con espacios sin reglas de escape
  readonly url: string;
  readonly env: readonly McpKeyValueDraft[];
  readonly headers: readonly McpKeyValueDraft[];
}

export type McpCommonMutation =
  | { readonly op: 'upsert'; readonly originalName: string | null; readonly draft: McpServerDraft }
  | { readonly op: 'remove'; readonly name: string }
  | { readonly op: 'setDisabled'; readonly name: string; readonly disabled: boolean }
  | { readonly op: 'setOnlyIn'; readonly name: string; readonly onlyIn: McpScope };

export interface McpCommonMutateParams {
  readonly mutation: McpCommonMutation;
  readonly expected: string | null;
}

export type McpWriteResult =
  | { readonly status: 'saved'; readonly notes: readonly string[] }
  | { readonly status: 'stale'; readonly message: string };

// Valores de un comun, SOLO tras pulsar «mostrar».
export interface McpRevealedSecrets {
  readonly env: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
}

// --- Estado sin mensaje (mcp_status, medido en 2.1.284) -----------------------------------------

export interface McpLiveStatus {
  readonly name: string;
  readonly status: string; // connected | pending | needs-auth | failed | disabled… (lo define el CLI)
  readonly scope: string | null; // user | project | local | dynamic | claudeai…
}

// configDir de la cuenta -> lo que contesto su CLI. Una cuenta que no contesto no aparece.
export type McpStatusByAccount = Readonly<Record<string, readonly McpLiveStatus[]>>;

// --- «Autenticar» un MCP que pide OAuth (0.1.1 R2, punto 18; medido en 2.1.285) ------------------

export interface McpAuthParams {
  readonly accountDir: string; // configDir de la cuenta: el token se guarda en SU .credentials.json
  readonly serverName: string; // nombre tal cual lo reporta el CLI (`plugin:figma:figma`)
}

// `connected`: el CLI recibio el callback y el servidor conecto. `opened`: la autorizacion se completa
// fuera y el CLI no espera callback (conectores de claude.ai). `timeout`: nadie completo el navegador a
// tiempo. `statuses` es el ultimo `mcp_status` de esa cuenta (null si no llego ninguno).
export type McpAuthResult =
  | { readonly kind: 'connected' | 'opened' | 'timeout'; readonly statuses: readonly McpLiveStatus[] | null }
  | { readonly kind: 'error'; readonly message: string };

// --- Proveedores: quien carga que («Solo en…») --------------------------------------------------

// Familia de proveedor a efectos de MCP. `local` = los modelos sin CLI de fabricante (los ejecuta el
// runtime propio de Mage).
export const MCP_PROVIDER_FAMILIES = ['claude', 'codex', 'agy', 'local'] as const;
export type McpProviderFamily = (typeof MCP_PROVIDER_FAMILIES)[number];

export const MCP_FAMILY_LABELS: Readonly<Record<McpProviderFamily, string>> = {
  claude: 'Claude',
  codex: 'Codex',
  agy: 'agy',
  local: 'Locales',
};

// Familia de un id de proveedor de Mage ('claude', 'agy', 'codex', de serie o `custom:`).
export function mcpFamilyOf(providerId: string): McpProviderFamily {
  if (providerId === 'claude' || providerId === 'agy' || providerId === 'codex') return providerId;
  return 'local';
}

// «Solo en…»: lista de destinos, cada uno `familia` (todas sus cuentas) o `familia|cuenta`. null = en
// todos los compatibles, que es el valor por defecto.
export type McpScope = readonly string[] | null;

export interface McpTarget {
  readonly family: McpProviderFamily;
  // Id de la cuenta en su proveedor (configDir en Claude). null = el proveedor no tiene cuentas.
  readonly accountId: string | null;
}

export function mcpScopeKey(family: McpProviderFamily, accountId: string | null = null): string {
  return accountId === null ? family : `${family}|${accountId}`;
}

export function isInMcpScope(scope: McpScope, target: McpTarget): boolean {
  if (scope === null) return true;
  if (scope.includes(target.family)) return true;
  return target.accountId !== null && scope.includes(mcpScopeKey(target.family, target.accountId));
}

// Familias que ALGUNA vez cargan algo con ese «Solo en…» (para las pastillas).
export function familiesInScope(scope: McpScope): readonly McpProviderFamily[] {
  if (scope === null) return MCP_PROVIDER_FAMILIES;
  return MCP_PROVIDER_FAMILIES.filter((family) => scope.some((key) => key === family || key.startsWith(`${family}|`)));
}

// Que familias pueden cargar un transporte. Medido (`spike/mcp-providers-spike.mjs`): codex solo tiene
// stdio y `streamable_http`; agy, stdio y http. SSE solo lo habla Claude.
export function familiesForTransport(transport: McpTransport): readonly McpProviderFamily[] {
  return transport === 'sse' ? ['claude', 'local'] : MCP_PROVIDER_FAMILIES;
}

// --- Extensiones .mcpb de Mage ------------------------------------------------------------------

export type McpUserConfigType = 'string' | 'number' | 'boolean' | 'directory' | 'file';
export type McpUserConfigValue = string | number | boolean | readonly string[] | null;

// Un campo de `user_config` para el formulario. Los `sensitive` nunca traen valor: solo `hasValue`.
export interface McpUserConfigField {
  readonly key: string;
  readonly type: McpUserConfigType;
  readonly title: string;
  readonly description: string;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly multiple: boolean;
  // Valor actual NO sensible (o el `default` del manifest si no hay). null en los sensibles.
  readonly value: McpUserConfigValue;
  readonly hasValue: boolean;
}

export interface McpExtensionView {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly platforms: readonly string[];
  readonly serverType: string; // node | python | binary | uv…
  readonly enabled: boolean;
  readonly onlyIn: McpScope;
  readonly fields: readonly McpUserConfigField[];
  readonly missingRequired: readonly string[];
  // Lo que impide cargarla (runtime ausente, plataforma, colision con un comun…). null = carga.
  readonly problem: string | null;
  readonly providers: readonly McpProviderFamily[];
  readonly dir: string;
}

// Extension de Claude Desktop que se puede importar (copiandola).
export interface McpDesktopExtensionCandidate {
  readonly dirName: string;
  readonly displayName: string;
  readonly version: string;
  readonly installed: boolean; // ya hay una de Mage con ese id
}

export interface McpExtensionList {
  readonly extensions: readonly McpExtensionView[];
  readonly desktop: readonly McpDesktopExtensionCandidate[];
  readonly warnings: readonly string[];
}

// Vista previa de una instalacion desde archivo, para que el usuario confirme con autor y firma.
// null = el usuario cancelo el dialogo de archivo.
export interface McpExtensionInstallPreview {
  readonly token: string;
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly author: string;
  readonly serverType: string;
  readonly platforms: readonly string[];
  readonly replacesVersion: string | null;
  readonly fileCount: number;
  readonly unpackedBytes: number;
}

export interface McpExtensionConfigParams {
  readonly id: string;
  // Clave -> valor nuevo. Ausente = sin cambios (un sensible que no se ha tocado); null = borrarlo.
  readonly values: Readonly<Record<string, McpUserConfigValue>>;
}

// --- Conectores ---------------------------------------------------------------------------------

// Ultimo estado conocido de una cuenta, con su fecha (ISO, UTC). Nunca lleva `config`.
export interface McpAccountSnapshot {
  readonly checkedAt: string;
  readonly servers: readonly McpLiveStatus[];
}

export type McpStatusCache = Readonly<Record<string, McpAccountSnapshot>>;

// Apps de ChatGPT (conectores de Codex) segun el esquema de `codex app-server` 0.144.4. SIN VERIFICAR:
// sin una sesion de ChatGPT `app/list` devuelve la lista vacia.
export interface CodexAppView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly accessible: boolean;
  readonly installUrl: string | null;
}

export interface CodexAccountMetadata {
  readonly authenticated: boolean | null;
  readonly apps: readonly CodexAppView[] | null;
  readonly error: string | null;
}

// --- Sincronizar con agy ------------------------------------------------------------------------

export type McpAgyChangeAction = 'add' | 'update' | 'remove' | 'skip';

export interface McpAgyChange {
  readonly name: string;
  readonly action: McpAgyChangeAction;
  readonly reason: string | null; // solo en `skip`
}

export interface McpAgySyncPreview {
  readonly path: string;
  readonly changes: readonly McpAgyChange[];
  // Huella del fichero de agy leido: el aplicar la devuelve (compare-and-swap).
  readonly expected: string | null;
  // Servidores con valores de la boveda: solo se copian (en claro) si el usuario lo confirma.
  readonly secretServers: readonly string[];
  readonly secretsConfirmed: readonly string[];
}

export interface McpAgySyncState {
  readonly auto: boolean;
  readonly exported: readonly string[];
  readonly secretsConfirmed: readonly string[];
  readonly lastSyncAt: string | null;
  readonly lastError: string | null;
}

export type McpAgySyncResult =
  | { readonly status: 'saved'; readonly changes: readonly McpAgyChange[]; readonly backupPath: string | null }
  | { readonly status: 'stale'; readonly message: string };

// --- Modelo puro del borrador (lo usan el editor del renderer y el guardado de main) -----------

const REMOTE_TRANSPORTS: readonly McpTransport[] = ['http', 'sse'];

export function isRemoteTransport(transport: McpTransport): boolean {
  return REMOTE_TRANSPORTS.includes(transport);
}

// Transporte de una declaracion cruda: `type` si es uno conocido; si no, `url` presente -> http (lo que
// hace el CLI con un remoto sin `type`); si no, local.
export function transportOf(raw: unknown): McpTransport {
  if (!isRecord(raw)) return 'stdio';
  if (raw.type === 'http' || raw.type === 'sse' || raw.type === 'stdio') return raw.type;
  return typeof raw.url === 'string' ? 'http' : 'stdio';
}

// Nombres de clave de un objeto de valores (`env`, `headers`). Nunca los valores.
export function keysOf(value: unknown): readonly string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

// Borrador desde la declaracion cruda. Sin `revealed`, cada valor de env/headers queda enmascarado
// (`null`); con `revealed`, se rellenan con los valores que devolvio «mostrar».
export function toServerDraft(name: string, raw: unknown, revealed: McpRevealedSecrets | null = null): McpServerDraft {
  const record = isRecord(raw) ? raw : {};
  return {
    name,
    transport: transportOf(record),
    command: typeof record.command === 'string' ? record.command : '',
    argsText: Array.isArray(record.args) ? record.args.map((arg) => String(arg)).join('\n') : '',
    url: typeof record.url === 'string' ? record.url : '',
    env: keysOf(record.env).map((key) => ({ key, value: revealed?.env[key] ?? null })),
    headers: keysOf(record.headers).map((key) => ({ key, value: revealed?.headers[key] ?? null })),
  };
}

// Claves que el editor gestiona segun el transporte. Al cambiar de local a remoto (o al reves) las del
// otro transporte se QUITAN: dejar un `command` en un servidor HTTP es justo el bug que habia.
const LOCAL_KEYS = ['command', 'args', 'env'] as const;
const REMOTE_KEYS = ['url', 'headers'] as const;
const MANAGED_KEYS: readonly string[] = ['type', ...LOCAL_KEYS, ...REMOTE_KEYS];

// Declaracion cruda desde el borrador. `previous` es lo que habia guardado con el nombre original (o
// null si es nuevo): de ahi salen los valores enmascarados y los campos que el editor no ofrece (`cwd`,
// `timeout`…), que se conservan. Lanza si el borrador no es valido o si un valor enmascarado no existe.
export function toServerObject(draft: McpServerDraft, previous: unknown): Record<string, unknown> {
  const problem = validateServerDraft(draft);
  if (problem !== null) throw new Error(problem);
  const base = isRecord(previous) ? previous : {};
  const kept = Object.fromEntries(Object.entries(base).filter(([key]) => !MANAGED_KEYS.includes(key)));
  if (isRemoteTransport(draft.transport)) {
    const headers = resolveValues(draft.headers, base.headers, `cabecera de "${draft.name}"`);
    return { type: draft.transport, url: draft.url.trim(), ...(Object.keys(headers).length > 0 ? { headers } : {}), ...kept };
  }
  const args = splitLines(draft.argsText);
  const env = resolveValues(draft.env, base.env, `variable de "${draft.name}"`);
  return {
    type: 'stdio',
    command: draft.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...kept,
  };
}

function resolveValues(entries: readonly McpKeyValueDraft[], previous: unknown, what: string): Record<string, string> {
  const stored = isRecord(previous) ? previous : {};
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (entry.value !== null) {
      result[key] = entry.value;
      continue;
    }
    const kept = stored[key];
    // Se nombra la CLAVE, nunca el valor.
    if (typeof kept !== 'string') throw new Error(`La ${what} "${key}" no tiene valor guardado: escribe uno.`);
    result[key] = kept;
  }
  return result;
}

// Primer problema de un borrador, o null. Mensajes para el usuario: nombran campos, nunca valores.
export function validateServerDraft(draft: McpServerDraft): string | null {
  const name = draft.name.trim();
  if (name.length === 0) return 'El servidor necesita un nombre.';
  if (isRemoteTransport(draft.transport)) {
    if (!isHttpUrl(draft.url.trim())) return `El servidor "${name}" necesita una URL http:// o https://.`;
    return validateKeys(draft.headers, `las cabeceras de "${name}"`);
  }
  if (draft.command.trim().length === 0) return `El servidor "${name}" no tiene comando.`;
  return validateKeys(draft.env, `las variables de entorno de "${name}"`);
}

// Validacion de la lista entera: el nombre es la CLAVE del objeto, asi que uno repetido perderia un
// servidor en silencio al guardar.
export function validateServers(drafts: readonly McpServerDraft[]): string | null {
  const seen = new Set<string>();
  for (const draft of drafts) {
    const problem = validateServerDraft(draft);
    if (problem !== null) return problem;
    const name = draft.name.trim();
    if (seen.has(name)) return `Hay dos servidores con el nombre "${name}": los nombres deben ser únicos.`;
    seen.add(name);
  }
  return null;
}

function validateKeys(entries: readonly McpKeyValueDraft[], what: string): string | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key.length === 0) return `Hay una clave vacía en ${what}.`;
    if (seen.has(key)) return `La clave "${key}" está repetida en ${what}.`;
    seen.add(key);
  }
  return null;
}

function isHttpUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === 'http:' || protocol === 'https:';
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
