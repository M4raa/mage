import { localized, renderForLog, type LocalizedText } from './i18n/localizedText';

// Reglas de comandos de agy y carpetas que Mage enlaza en su perfil (grupo E, fase 2). Puro: lo usan
// el renderer (dialogo de comandos, Ajustes) y main (settings.json del perfil, enlaces).
//
// Medido en agy 1.2.14 (`node spike/agy-spike.mjs --permissions` y `--profile`):
//   - `command(<linea>)` casa la linea EXACTA, redirecciones incluidas; no es un prefijo;
//   - `command(regex:<re>)` casa por expresion: la UI NO ofrece regex, asi que un comando que empiece
//     por `regex:` se rechaza (escrito tal cual se leeria como expresion);
//   - `deny` gana a `allow`; agy lee las reglas SOLO al lanzar (cambiarlas a mitad no afecta a la sesion).
//   - fase 3 (`--mcp-rules`): una tool MCP pide `mcp(<servidor>/<tool>)`; `mcp(<servidor>/*)` vale para
//     todas las del servidor, y un deny exacto gana a ese comodin.

// Reglas tal como las guarda Mage: un comando exacto (sin el envoltorio `command(…)`) o una regla MCP
// ya en su forma de agy, `mcp(<servidor>/<tool>)`. Comparten lista para que el aviso de denegado y el
// guardado no distingan: un comando nunca empieza por `mcp(` (se rechaza al validarlo).
export interface AgyCommandRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export const EMPTY_AGY_COMMAND_RULES: AgyCommandRules = { allow: [], deny: [] };

export type AgyCommandVerdict = 'allow' | 'deny';

const REGEX_RULE_PREFIX = 'regex:';

// Linea de comando valida para una regla, o el motivo por el que no lo es.
export function validateAgyCommand(input: string): { readonly ok: true; readonly command: string } | { readonly ok: false; readonly message: LocalizedText } {
  const command = input.trim();
  if (command.length === 0) return { ok: false, message: localized('settings.agy.commandEmpty') };
  if (/[\r\n]/.test(command)) return { ok: false, message: localized('settings.agy.commandMultiline') };
  if (command.startsWith(REGEX_RULE_PREFIX)) {
    return { ok: false, message: localized('settings.agy.commandRegexPrefix', { prefix: REGEX_RULE_PREFIX }) };
  }
  if (command.startsWith(MCP_RULE_PREFIX)) return { ok: false, message: localized('settings.agy.commandIsMcpRule') };
  return { ok: true, command };
}

const MCP_RULE_PREFIX = 'mcp(';
// Comodin de herramienta: todas las del servidor (medido). De servidor no se ofrece: no esta medido.
export const AGY_MCP_ANY_TOOL = '*';
// Nombre de servidor o de herramienta: sin `/`, parentesis ni espacios (romperian la regla).
const MCP_NAME = /^[^\s/()]+$/;
const MCP_RULE = /^mcp\(([^\s/()]+)\/([^\s/()]+)\)$/;

export interface AgyMcpTool {
  readonly server: string;
  readonly tool: string; // nombre exacto o AGY_MCP_ANY_TOOL
}

// Regla `mcp(<servidor>/<tool>)` para un servidor y una herramienta, o el motivo por el que no vale.
export function validateAgyMcpTool(server: string, tool: string): { readonly ok: true; readonly rule: string } | { readonly ok: false; readonly message: LocalizedText } {
  const cleanServer = server.trim();
  const cleanTool = tool.trim();
  if (cleanServer.length === 0) return { ok: false, message: localized('settings.agy.mcpServerMissing') };
  if (!MCP_NAME.test(cleanServer) || cleanServer === AGY_MCP_ANY_TOOL) return { ok: false, message: localized('settings.agy.mcpServerInvalid', { server: cleanServer }) };
  if (cleanTool.length === 0) return { ok: false, message: localized('settings.agy.mcpToolMissing', { wildcard: AGY_MCP_ANY_TOOL }) };
  if (!MCP_NAME.test(cleanTool)) return { ok: false, message: localized('settings.agy.mcpToolInvalid') };
  return { ok: true, rule: `${MCP_RULE_PREFIX}${cleanServer}/${cleanTool})` };
}

// Servidor y herramienta de una regla MCP guardada (null = es un comando).
export function parseAgyMcpRule(rule: string): AgyMcpTool | null {
  const match = MCP_RULE.exec(rule);
  return match === null ? null : { server: match[1] ?? '', tool: match[2] ?? '' };
}

// Una regla guardable: comando exacto valido o regla MCP bien formada.
export function isValidAgyRule(rule: string): boolean {
  return parseAgyMcpRule(rule) !== null || validateAgyCommand(rule).ok;
}

// Servidores MCP que carga agy, para elegir en el dialogo: los de su `mcp_config.json` (el de
// `~/.gemini/config`, enlazado en el perfil) y los que exporto Mage. Ordenados y sin repetir.
export function agyMcpServerNames(rows: readonly { readonly name: string; readonly providers: readonly string[] }[]): readonly string[] {
  const names = rows.filter((row) => row.providers.includes('agy') && MCP_NAME.test(row.name)).map((row) => row.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

// Pone `command` (un comando exacto o una regla MCP) en la lista del veredicto y lo quita de la otra
// (null = quitarlo de las dos).
export function setAgyCommandVerdict(rules: AgyCommandRules, input: string, verdict: AgyCommandVerdict | null): AgyCommandRules {
  const trimmed = input.trim();
  const checked = parseAgyMcpRule(trimmed) === null ? validateAgyCommand(input) : ({ ok: true, command: trimmed } as const);
  if (!checked.ok) throw new Error(`Comando de agy invalido ${JSON.stringify(input)}: ${renderForLog(checked.message)}`);
  const { command } = checked;
  const allow = rules.allow.filter((entry) => entry !== command);
  const deny = rules.deny.filter((entry) => entry !== command);
  if (verdict === 'allow') return { allow: [...allow, command], deny };
  if (verdict === 'deny') return { allow, deny: [...deny, command] };
  return { allow, deny };
}

// Reglas en el formato del settings.json de agy.
export function toAgyPermissionRules(rules: AgyCommandRules): AgyCommandRules {
  const wrap = (rule: string): string => (parseAgyMcpRule(rule) === null ? `command(${rule})` : rule);
  return { allow: rules.allow.map(wrap), deny: rules.deny.map(wrap) };
}

// Carpetas de la casa del usuario que Mage enlaza SIEMPRE en el perfil de agy: la config de agy (skills,
// plugins, MCP, proyectos; compartida con el IDE de Antigravity) y las claves SSH.
export const AGY_DEFAULT_LINKED_PATHS: readonly string[] = ['.gemini/config', '.ssh'];

// Donde vive lo que Mage escribe en el perfil (settings.json con las reglas): nunca se enlaza.
const AGY_CLI_DIR = ['.gemini', 'antigravity-cli'] as const;

// Ruta extra para enlazar (relativa a la casa del usuario, con `/`), o el motivo por el que no vale.
export function validateAgyLinkPath(input: string): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: LocalizedText } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: localized('settings.agy.linkPathEmpty') };
  if (/^([A-Za-z]:|[\\/]|~)/.test(trimmed)) return { ok: false, message: localized('settings.agy.linkPathNotRelative') };
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0) return { ok: false, message: localized('settings.agy.linkPathEmpty') };
  if (segments.includes('..')) return { ok: false, message: localized('settings.agy.linkPathOutsideHome') };
  const [first, second] = segments;
  if (first === AGY_CLI_DIR[0] && (second === undefined || second === AGY_CLI_DIR[1])) {
    return { ok: false, message: localized('settings.agy.linkPathIsProfile') };
  }
  return { ok: true, path: segments.join('/') };
}

// Las carpetas que se enlazan: las de serie y las extra validas, sin repetir (en Windows sin distinguir
// mayusculas, como su sistema de ficheros).
export function agyLinkedPaths(extra: readonly string[], caseInsensitive: boolean): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...AGY_DEFAULT_LINKED_PATHS, ...extra]) {
    const checked = validateAgyLinkPath(candidate);
    if (!checked.ok) continue;
    const key = caseInsensitive ? checked.path.toLowerCase() : checked.path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(checked.path);
  }
  return out;
}
