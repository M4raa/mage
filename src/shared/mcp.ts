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
  | 'desktopExtension'; // extension MCPB instalada en Claude Desktop

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
  // Extension MCPB que no se puede copiar tal cual (necesita `user_config`…). null = se puede.
  readonly blockedReason: string | null;
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
  readonly blockedReason: string | null;
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
  | { readonly op: 'setDisabled'; readonly name: string; readonly disabled: boolean };

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
