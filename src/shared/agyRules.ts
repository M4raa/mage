// Reglas de comandos de agy y carpetas que Mage enlaza en su perfil (grupo E, fase 2). Puro: lo usan
// el renderer (dialogo de comandos, Ajustes) y main (settings.json del perfil, enlaces).
//
// Medido en agy 1.2.14 (`node spike/agy-spike.mjs --permissions` y `--profile`):
//   - `command(<linea>)` casa la linea EXACTA, redirecciones incluidas; no es un prefijo;
//   - `command(regex:<re>)` casa por expresion: la UI NO ofrece regex, asi que un comando que empiece
//     por `regex:` se rechaza (escrito tal cual se leeria como expresion);
//   - `deny` gana a `allow`; agy lee las reglas SOLO al lanzar (cambiarlas a mitad no afecta a la sesion).

// Reglas por comando exacto, tal como las guarda Mage (sin el envoltorio `command(…)`).
export interface AgyCommandRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export const EMPTY_AGY_COMMAND_RULES: AgyCommandRules = { allow: [], deny: [] };

export type AgyCommandVerdict = 'allow' | 'deny';

const REGEX_RULE_PREFIX = 'regex:';

// Linea de comando valida para una regla, o el motivo por el que no lo es.
export function validateAgyCommand(input: string): { readonly ok: true; readonly command: string } | { readonly ok: false; readonly message: string } {
  const command = input.trim();
  if (command.length === 0) return { ok: false, message: 'Escribe el comando exacto.' };
  if (/[\r\n]/.test(command)) return { ok: false, message: 'Un comando por regla, en una sola línea.' };
  if (command.startsWith(REGEX_RULE_PREFIX)) {
    return { ok: false, message: `Un comando que empieza por «${REGEX_RULE_PREFIX}» agy lo leería como expresión regular.` };
  }
  return { ok: true, command };
}

// Pone `command` en la lista del veredicto y lo quita de la otra (null = quitarlo de las dos).
export function setAgyCommandVerdict(rules: AgyCommandRules, input: string, verdict: AgyCommandVerdict | null): AgyCommandRules {
  const checked = validateAgyCommand(input);
  if (!checked.ok) throw new Error(`Comando de agy invalido ${JSON.stringify(input)}: ${checked.message}`);
  const { command } = checked;
  const allow = rules.allow.filter((entry) => entry !== command);
  const deny = rules.deny.filter((entry) => entry !== command);
  if (verdict === 'allow') return { allow: [...allow, command], deny };
  if (verdict === 'deny') return { allow, deny: [...deny, command] };
  return { allow, deny };
}

// Reglas en el formato del settings.json de agy.
export function toAgyPermissionRules(rules: AgyCommandRules): AgyCommandRules {
  const wrap = (command: string): string => `command(${command})`;
  return { allow: rules.allow.map(wrap), deny: rules.deny.map(wrap) };
}

// Carpetas de la casa del usuario que Mage enlaza SIEMPRE en el perfil de agy: la config de agy (skills,
// plugins, MCP, proyectos; compartida con el IDE de Antigravity) y las claves SSH.
export const AGY_DEFAULT_LINKED_PATHS: readonly string[] = ['.gemini/config', '.ssh'];

// Donde vive lo que Mage escribe en el perfil (settings.json con las reglas): nunca se enlaza.
const AGY_CLI_DIR = ['.gemini', 'antigravity-cli'] as const;

// Ruta extra para enlazar (relativa a la casa del usuario, con `/`), o el motivo por el que no vale.
export function validateAgyLinkPath(input: string): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: 'Escribe una carpeta.' };
  if (/^([A-Za-z]:|[\\/]|~)/.test(trimmed)) return { ok: false, message: 'Escríbela relativa a tu carpeta de usuario, p. ej. .aws' };
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0) return { ok: false, message: 'Escribe una carpeta.' };
  if (segments.includes('..')) return { ok: false, message: 'La carpeta tiene que estar dentro de tu carpeta de usuario.' };
  const [first, second] = segments;
  if (first === AGY_CLI_DIR[0] && (second === undefined || second === AGY_CLI_DIR[1])) {
    return { ok: false, message: 'Esa carpeta es la del propio perfil de agy: no se puede enlazar.' };
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
