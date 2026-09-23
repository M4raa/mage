// Modelo PURO (sin React, sin IPC) del contenido de los dos ficheros de configuracion compartida.
// Existe para que la UI por bloques (servidores MCP, hooks y reglas de permisos) no tenga que
// manipular JSON a mano en medio de un componente: aqui se entra desde el TEXTO crudo que devuelve
// `loadSharedConfig` y se sale con el TEXTO crudo que espera `saveSharedConfig`.
//
// El fichero en disco sigue siendo el MISMO JSON que lee el CLI: lo que cambia es como se edita. Por
// eso todo serializador parte del texto actual y solo SUSTITUYE su clave, preservando cualquier otra
// (y, en los servidores MCP, los campos que esta UI no ofrece: `url`, `type`, `cwd`...).

// --- Servidores MCP (mcp-common.json) -----------------------------------------------------------

export interface McpServerDraft {
  readonly name: string;
  readonly command: string;
  // Una linea por argumento / una linea `CLAVE=valor` por variable: es lo unico que aguanta rutas y
  // valores con espacios sin inventar reglas de escapado propias.
  readonly argsText: string;
  readonly envText: string;
  // Campos que esta UI no edita (`type`, `url`, `cwd`, lo que traiga el usuario). Se conservan tal
  // cual al guardar: un editor por bloques que borra lo que no entiende destruye configuracion.
  readonly rest: Readonly<Record<string, unknown>>;
}

export interface McpServersParse {
  readonly servers: readonly McpServerDraft[];
  readonly error: string | null;
}

const EDITED_SERVER_KEYS: readonly string[] = ['command', 'args', 'env'];

// Lee el texto crudo y devuelve un borrador por servidor. Texto inservible -> lista vacia + `error`
// con el motivo (la UI lo enseña); nunca se traga el fallo en silencio.
export function parseMcpServers(text: string): McpServersParse {
  const root = parseJsonObject(text);
  if (root.value === null) return { servers: [], error: root.error };
  const servers = root.value.mcpServers;
  if (servers === undefined) return { servers: [], error: null };
  if (!isRecord(servers)) return { servers: [], error: `"mcpServers" no es un objeto: ${describeType(servers)}` };

  return { servers: Object.entries(servers).map(([name, raw]) => toServerDraft(name, raw)), error: null };
}

function toServerDraft(name: string, raw: unknown): McpServerDraft {
  if (!isRecord(raw)) return { name, command: '', argsText: '', envText: '', rest: {} };
  const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => !EDITED_SERVER_KEYS.includes(key)));
  return {
    name,
    command: typeof raw.command === 'string' ? raw.command : '',
    argsText: Array.isArray(raw.args) ? raw.args.map((arg) => String(arg)).join('\n') : '',
    envText: isRecord(raw.env)
      ? Object.entries(raw.env)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join('\n')
      : '',
    rest,
  };
}

// Vuelca la lista completa de servidores sobre el texto actual. Lanza si el texto de partida no es
// JSON valido: esta funcion la llama "Guardar", y guardar sobre una base que no se entiende es
// exactamente como se pierde la configuracion ajena.
export function serializeMcpServers(text: string, servers: readonly McpServerDraft[]): string {
  const root = requireJsonObject(text, 'mcp-common.json');
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) mcpServers[server.name] = toServerObject(server);
  return stringify({ ...root, mcpServers });
}

function toServerObject(server: McpServerDraft): Record<string, unknown> {
  const object: Record<string, unknown> = { ...server.rest, command: server.command };
  const args = splitLines(server.argsText);
  if (args.length > 0) object.args = args;
  const env = parseEnvText(server.envText);
  if (env.error !== null) throw new Error(`Variables de entorno de "${server.name}" inválidas: ${env.error}`);
  if (Object.keys(env.value).length > 0) object.env = env.value;
  return object;
}

export interface EnvParse {
  readonly value: Readonly<Record<string, string>>;
  readonly error: string | null;
}

// `CLAVE=valor` por linea. El primer `=` separa: los valores llevan rutas, URLs y tokens con `=`.
export function parseEnvText(text: string): EnvParse {
  const value: Record<string, string> = {};
  for (const line of splitLines(text)) {
    const separator = line.indexOf('=');
    if (separator <= 0) return { value: {}, error: `la línea "${line}" no tiene la forma CLAVE=valor` };
    value[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return { value, error: null };
}

// --- Hooks y permisos (settings-common.json) ----------------------------------------------------

export interface HookDraft {
  readonly event: string;
  // null = sin `matcher` (el hook aplica a todo el evento), que NO es lo mismo que la cadena vacia.
  readonly matcher: string | null;
  readonly command: string;
}

export type PermissionEffect = 'allow' | 'deny';

export interface PermissionDraft {
  readonly effect: PermissionEffect;
  readonly pattern: string;
}

export interface CommonSettingsParse {
  readonly hooks: readonly HookDraft[];
  readonly permissions: readonly PermissionDraft[];
  readonly error: string | null;
}

// Aplana `{evento: [{matcher, hooks: [{command}]}]}` a una fila por comando, que es la unidad que el
// usuario reconoce ("este comando corre en este evento") y la que ya enseña la vista de union.
export function parseCommonSettings(text: string): CommonSettingsParse {
  const root = parseJsonObject(text);
  if (root.value === null) return { hooks: [], permissions: [], error: root.error };
  return {
    hooks: flattenHooks(root.value.hooks),
    permissions: flattenPermissions(root.value.permissions),
    error: null,
  };
}

function flattenHooks(raw: unknown): readonly HookDraft[] {
  if (!isRecord(raw)) return [];
  const drafts: HookDraft[] = [];
  for (const [event, groups] of Object.entries(raw)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
      const matcher = typeof group.matcher === 'string' ? group.matcher : null;
      for (const hook of group.hooks) {
        if (isRecord(hook) && typeof hook.command === 'string') drafts.push({ event, matcher, command: hook.command });
      }
    }
  }
  return drafts;
}

function flattenPermissions(raw: unknown): readonly PermissionDraft[] {
  if (!isRecord(raw)) return [];
  const drafts: PermissionDraft[] = [];
  // `deny` primero: es el que manda en el CLI, mismo orden que ya usa la vista de ajustes efectivos.
  for (const effect of ['deny', 'allow'] as const) {
    const list = raw[effect];
    if (!Array.isArray(list)) continue;
    for (const pattern of list) if (typeof pattern === 'string') drafts.push({ effect, pattern });
  }
  return drafts;
}

// Reagrupa los hooks planos a la forma del CLI: un grupo por (evento, matcher), preservando el orden
// de aparicion. Si no queda ninguno se BORRA la clave (dejar `"hooks": {}` es ruido en el fichero).
export function serializeCommonSettings(
  text: string,
  hooks: readonly HookDraft[],
  permissions: readonly PermissionDraft[],
): string {
  const root = requireJsonObject(text, 'settings-common.json');
  const next: Record<string, unknown> = { ...root };
  const grouped = groupHooks(hooks);
  if (Object.keys(grouped).length > 0) next.hooks = grouped;
  else delete next.hooks;

  const rules = groupPermissions(permissions);
  if (rules !== null) next.permissions = rules;
  else delete next.permissions;
  return stringify(next);
}

interface HookGroup {
  matcher?: string;
  readonly hooks: { readonly type: 'command'; readonly command: string }[];
}

function groupHooks(hooks: readonly HookDraft[]): Record<string, unknown> {
  // Indice (evento -> matcher -> grupo): O(n) en vez de re-escanear lo ya escrito por cada hook.
  const byEvent = new Map<string, Map<string, HookGroup>>();
  for (const hook of hooks) {
    if (hook.command.trim().length === 0 || hook.event.trim().length === 0) continue;
    const groups = byEvent.get(hook.event) ?? new Map<string, HookGroup>();
    byEvent.set(hook.event, groups);
    const key = hook.matcher ?? '';
    const group = groups.get(key) ?? (hook.matcher === null ? { hooks: [] } : { matcher: hook.matcher, hooks: [] });
    groups.set(key, group);
    group.hooks.push({ type: 'command', command: hook.command });
  }
  return Object.fromEntries([...byEvent].map(([event, groups]) => [event, [...groups.values()]]));
}

function groupPermissions(permissions: readonly PermissionDraft[]): Record<string, string[]> | null {
  const result: Record<string, string[]> = {};
  for (const effect of ['allow', 'deny'] as const) {
    const patterns = permissions.filter((rule) => rule.effect === effect && rule.pattern.trim().length > 0);
    if (patterns.length > 0) result[effect] = patterns.map((rule) => rule.pattern);
  }
  return Object.keys(result).length > 0 ? result : null;
}

// --- Utilidades comunes -------------------------------------------------------------------------

interface JsonObjectParse {
  readonly value: Record<string, unknown> | null;
  readonly error: string | null;
}

function parseJsonObject(text: string): JsonObjectParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { value: null, error: `JSON inválido: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(parsed)) return { value: null, error: `el contenido no es un objeto JSON: ${describeType(parsed)}` };
  return { value: parsed, error: null };
}

function requireJsonObject(text: string, label: string): Record<string, unknown> {
  const { value, error } = parseJsonObject(text);
  if (value === null) throw new Error(`No se puede editar ${label}: ${error ?? 'contenido desconocido'}`);
  return value;
}

function stringify(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function describeType(value: unknown): string {
  return Array.isArray(value) ? 'un array' : `un ${typeof value}`;
}
