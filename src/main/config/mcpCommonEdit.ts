import { toServerObject, type McpCommonMutation, type McpRevealedSecrets } from '@shared/mcp';
import { DISABLED_SERVERS_KEY, parseCommonRoot } from './mcpInventory';

// Edicion de mcp-common.json desde el editor por servidor (P-028 punto 5). PURO: texto de entrada ->
// texto de salida. Aqui, en main, es donde un valor enmascarado del renderer (`null`) se resuelve
// contra lo guardado: el renderer nunca ha tenido ese valor.
//
// Un comun vive en `mcpServers` (activo) o en `mageDisabledServers` (desactivado: el CLI no lo carga).
// El resto de claves del fichero se conserva tal cual.

export function applyMcpCommonMutation(text: string, mutation: McpCommonMutation): string {
  const root = parseCommonRoot(text);
  const maps = { active: { ...recordOrEmpty(root.mcpServers) }, disabled: { ...recordOrEmpty(root[DISABLED_SERVERS_KEY]) } };
  if (mutation.op === 'upsert') upsert(maps, mutation.originalName, mutation.draft);
  else if (mutation.op === 'remove') remove(maps, mutation.name);
  else setDisabled(maps, mutation.name, mutation.disabled);
  const next: Record<string, unknown> = { ...root, mcpServers: maps.active };
  if (Object.keys(maps.disabled).length > 0) next[DISABLED_SERVERS_KEY] = maps.disabled;
  else delete next[DISABLED_SERVERS_KEY];
  return `${JSON.stringify(next, null, 2)}\n`;
}

// Valores de `env`/`headers` de un comun, para el «mostrar» explicito del editor. Unica via por la que
// un valor llega al renderer. Lanza si el nombre no es un comun.
export function revealMcpCommonSecrets(text: string, name: string): McpRevealedSecrets {
  const root = parseCommonRoot(text);
  const config = recordOrEmpty(root.mcpServers)[name] ?? recordOrEmpty(root[DISABLED_SERVERS_KEY])[name];
  if (!isRecord(config)) throw new Error(`"${name}" no es un servidor común de Mage`);
  return { env: stringValues(config.env), headers: stringValues(config.headers) };
}

interface CommonMaps {
  readonly active: Record<string, unknown>;
  readonly disabled: Record<string, unknown>;
}

function upsert(maps: CommonMaps, originalName: string | null, draft: Parameters<typeof toServerObject>[0]): void {
  const name = draft.name.trim();
  const holder = originalName === null ? null : holderOf(maps, originalName);
  if (originalName !== null && holder === null) throw new Error(`"${originalName}" ya no está en mcp-common.json`);
  if (name !== originalName && holderOf(maps, name) !== null) throw new Error(`Ya hay un servidor común llamado "${name}"`);
  const previous = holder === null || originalName === null ? null : holder[originalName];
  const object = toServerObject({ ...draft, name }, previous);
  const target = holder ?? maps.active;
  if (originalName !== null && holder !== null) delete holder[originalName];
  target[name] = object;
}

function remove(maps: CommonMaps, name: string): void {
  const holder = holderOf(maps, name);
  if (holder === null) throw new Error(`"${name}" ya no está en mcp-common.json`);
  delete holder[name];
}

function setDisabled(maps: CommonMaps, name: string, disabled: boolean): void {
  const holder = holderOf(maps, name);
  if (holder === null) throw new Error(`"${name}" ya no está en mcp-common.json`);
  const target = disabled ? maps.disabled : maps.active;
  if (holder === target) return;
  target[name] = holder[name];
  delete holder[name];
}

function holderOf(maps: CommonMaps, name: string): Record<string, unknown> | null {
  if (Object.hasOwn(maps.active, name)) return maps.active;
  if (Object.hasOwn(maps.disabled, name)) return maps.disabled;
  return null;
}

function stringValues(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, String(v)]));
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
