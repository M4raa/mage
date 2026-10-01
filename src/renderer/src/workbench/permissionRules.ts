// Reglas "Permitir siempre <tool> aqui" de UNA conversacion (2.3b). PURO: datos -> datos.
//
// Alcance, dicho en voz alta porque es una decision de seguridad: la regla es POR CONVERSACION y POR
// NOMBRE DE TOOL. Lo primero, porque "aqui" es esta conversacion — una regla que se filtrara a otras
// conversaciones de la misma carpeta seria una sorpresa desagradable. Lo segundo es el TECHO conocido:
// `Permitir siempre Bash aqui` autoriza CUALQUIER comando en esta conversacion, no solo el que estaba
// en pantalla. Es exactamente lo que promete el boton, se ve listado en el panel de Permisos y se
// revoca desde ahi. La via de mejora, si algun dia hace falta, es un patron por tool (`Bash(git log:*)`
// como hace el propio CLI) en vez de solo el nombre — el resto de la maquinaria no cambiaria.
//
// Nunca se crea una regla sola: solo la crea el usuario pulsando el boton de la tarjeta.

// ¿Esta tool tiene permiso permanente en esta conversacion?
export function isAlwaysAllowed(rules: readonly string[], toolName: string): boolean {
  const wanted = toolName.trim();
  if (wanted.length === 0) return false;
  return rules.includes(wanted);
}

// Añade la regla. Idempotente y con ORDEN ESTABLE (la nueva al final): el panel las lista en el orden
// en que se concedieron, que es el que ayuda a reconocerlas. Una tool vacia no genera regla: seria una
// regla que casa con nada y solo ensuciaria la lista.
export function addAlwaysAllow(rules: readonly string[], toolName: string): readonly string[] {
  const wanted = toolName.trim();
  if (wanted.length === 0 || rules.includes(wanted)) return rules;
  return [...rules, wanted];
}

// Revoca la regla. Devuelve el MISMO array si no estaba (mismo contrato que `cancelQuestionBlock` en
// engineBlocks): el caller puede distinguir "no habia nada que cambiar" sin comparar contenidos.
export function removeAlwaysAllow(rules: readonly string[], toolName: string): readonly string[] {
  if (!rules.includes(toolName)) return rules;
  return rules.filter((rule) => rule !== toolName);
}

// Lo que se persiste en el indice: lista saneada (sin vacios, sin duplicados, orden conservado). Se
// aplica al LEER del indice, que es un fichero que puede haberse editado a mano o venir de una version
// anterior de Mage — la frontera valida, no confia.
export function sanitizeAlwaysAllow(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    clean.push(trimmed);
  }
  return clean;
}

// --- Barreras del turno de «Crear PR» (grupo D, como Claude Desktop) ----------------------------------
// Mientras dura el turno que pidio crear el PR, un `Bash` que fuerce el push, salte los hooks, reescriba
// historia o publique en otro repo se DENIEGA sin preguntar. Un push normal de la rama a su remoto vale.
// Techo conocido: solo actua cuando el CLI pide permiso; con «Omitir permisos» el CLI no pregunta.
// ponytail: tokenizado por espacios, sin entender comillas; un `--force` dentro de un mensaje entre
// comillas tambien se rechaza (el lado seguro). Si molesta, un tokenizador de shell de verdad.

const SEGMENT_SEPARATORS = /&&|\|\||[;|\n]/;

type Rule = { readonly command: readonly string[]; readonly long: readonly string[]; readonly short: string; readonly plusRefspec?: boolean };

const PR_TURN_RULES: readonly Rule[] = [
  { command: ['git', 'push'], long: ['--force', '--force-with-lease', '--force-if-includes', '--delete', '--mirror', '--prune', '--push-option', '--no-verify'], short: 'fdo', plusRefspec: true },
  { command: ['git', 'commit'], long: ['--no-verify', '--amend', '--allow-empty', '--file'], short: 'nF' },
  { command: ['gh', 'pr', 'create'], long: ['--repo', '--head', '--body-file', '--recover'], short: 'RHF' },
];

// Motivo por el que se bloquea el comando en el turno de PR, o null si se puede dejar pasar.
export function prTurnBlockReason(command: string): string | null {
  for (const segment of command.split(SEGMENT_SEPARATORS)) {
    const tokens = segment.trim().split(/\s+/).filter((token) => token.length > 0);
    for (const rule of PR_TURN_RULES) {
      const flag = blockedFlag(tokens, rule);
      if (flag !== null) return `${rule.command.join(' ')} ${flag}`;
    }
  }
  return null;
}

function blockedFlag(tokens: readonly string[], rule: Rule): string | null {
  const start = commandStart(tokens, rule.command);
  if (start < 0) return null;
  for (const token of tokens.slice(start + rule.command.length)) {
    const name = token.split('=')[0]!;
    if (rule.long.some((flag) => name === flag || (flag === '--force' && name.startsWith('--force')))) return name;
    if (/^-[a-zA-Z]+$/.test(token) && [...token.slice(1)].some((letter) => rule.short.includes(letter))) return token;
    if (rule.plusRefspec === true && token.startsWith('+')) return token;
  }
  return null;
}

// Indice donde empieza el comando (`git push`, `gh pr create`), saltando `git -C <ruta>`/`-c k=v`.
function commandStart(tokens: readonly string[], command: readonly string[]): number {
  const head = tokens.indexOf(command[0]!);
  if (head < 0) return -1;
  let i = head + 1;
  while (tokens[i] === '-C' || tokens[i] === '-c') i += 2;
  const rest = command.slice(1);
  return rest.every((word, k) => tokens[i + k] === word) ? i - 1 : -1;
}
