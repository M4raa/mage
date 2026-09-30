// Modelo PURO (sin React, sin IPC) del contenido de settings-common.json (los servidores MCP tienen el
// suyo en `@shared/mcp`, P-028: su texto ya no llega al renderer).
// Existe para que la UI por bloques (hooks y reglas de permisos) no tenga que
// manipular JSON a mano en medio de un componente: aqui se entra desde el TEXTO crudo que devuelve
// `loadSharedConfig` y se sale con el TEXTO crudo que espera `saveSharedConfig`.
//
// El fichero en disco sigue siendo el MISMO JSON que lee el CLI: lo que cambia es como se edita. Por
// eso todo serializador parte del texto actual y solo SUSTITUYE su clave, preservando cualquier otra.

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  return Array.isArray(value) ? 'un array' : `un ${typeof value}`;
}
