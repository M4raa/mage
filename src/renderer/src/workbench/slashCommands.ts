// Autocompletado de comandos "/" del PromptBar (M2.6 + D4). Los comandos se pasan tal cual como
// mensaje de usuario y el CLI los interpreta. Modulo PURO -> testable.
//
// DESCUBRIMIENTO DINAMICO (D4): la fuente de verdad es la SESION, no una lista escrita a mano. El
// evento `system/init` del CLI trae `slash_commands` con los comandos reales, incluidos los del
// proyecto, plugins y skills (60 en la maquina del usuario, con nombres namespaced tipo
// `itb-skills:itb-core`). La lista curada de abajo se queda SOLO como fuente de descripciones legibles
// y como fallback mientras la sesion no ha arrancado.
//
// Por que manda la sesion: al comparar la lista curada con la real se vio que 6 de los 18 curados
// (`cost`, `help`, `hooks`, `memory`, `permissions`, `status`) NO existian en el CLI headless — son de
// la TUI. Ofrecerlos era enganar al usuario: al enviarlos, el CLI los trata como texto normal y el
// modelo responde a un prompt que dice "/status". Revisado contra 2.1.284 (P-028, grupo C): `cost` ya
// existe, como alias de `usage`; `review` ya no existe y `agents` solo contesta «wizard removed».

import { t } from '../i18n/uiLanguage';

export interface SlashCommand {
  readonly name: string; // sin la barra (p.ej. 'compact')
  readonly description: string;
  // Pista del argumento que espera el comando, tal cual la da el CLI (2.2). Se PINTA en el popover; NO
  // se inserta al completar, porque es una descripcion y no un valor. null si el comando no la trae.
  readonly argumentHint?: string | null;
  // Nombres alternativos con los que tambien se puede escribir el comando. El filtro casa contra ellos,
  // pero se completa SIEMPRE con el nombre canonico.
  readonly aliases?: readonly string[];
}

// Nº maximo de sugerencias del popover (la lista completa no cabe y no aporta).
export const SLASH_SUGGESTION_LIMIT = 8;

type CuratedDescriptionKey =
  | 'prompt.slash.desc.clear'
  | 'prompt.slash.desc.compact'
  | 'prompt.slash.desc.config'
  | 'prompt.slash.desc.context'
  | 'prompt.slash.desc.doctor'
  | 'prompt.slash.desc.effort'
  | 'prompt.slash.desc.init'
  | 'prompt.slash.desc.mcp'
  | 'prompt.slash.desc.model'
  | 'prompt.slash.desc.rename'
  | 'prompt.slash.desc.securityReview'
  | 'prompt.slash.desc.usage'
  | 'prompt.slash.desc.help'
  | 'prompt.slash.desc.hooks'
  | 'prompt.slash.desc.memory'
  | 'prompt.slash.desc.permissions'
  | 'prompt.slash.desc.status';

// Comando de la lista curada: su descripción se traduce al LEERLA (la lista se evalúa al importar, antes de saber
// el idioma, y tiene que seguir al idioma activo).
function curated(name: string, descriptionKey: CuratedDescriptionKey, aliases?: readonly string[]): SlashCommand {
  return {
    name,
    get description() {
      return t(descriptionKey);
    },
    ...(aliases === undefined ? {} : { aliases }),
  };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  curated('clear', 'prompt.slash.desc.clear'),
  curated('compact', 'prompt.slash.desc.compact'),
  curated('config', 'prompt.slash.desc.config'),
  curated('context', 'prompt.slash.desc.context'),
  curated('doctor', 'prompt.slash.desc.doctor'),
  curated('effort', 'prompt.slash.desc.effort'),
  curated('init', 'prompt.slash.desc.init'),
  curated('mcp', 'prompt.slash.desc.mcp'),
  curated('model', 'prompt.slash.desc.model'),
  curated('rename', 'prompt.slash.desc.rename'),
  curated('security-review', 'prompt.slash.desc.securityReview'),
  curated('usage', 'prompt.slash.desc.usage', ['cost', 'stats']),
];

// Los que D4 midio que NO existen en el CLI headless (son de la TUI). FUERA de `SLASH_COMMANDS` a
// proposito, porque esa lista es la que se OFRECE cuando la sesion aun no ha reportado los suyos — y
// como `ensureSession` es perezoso, ese es justo el estado de cualquier conversacion recien abierta:
// ofrecerlos ahi era engañar exactamente igual que ofrecerlos con la sesion viva (`pnpm verify:gui` lo
// encontro el 2026-08-12). Sus descripciones se conservan por si una version futura del CLI headless
// los declara: entonces vendran de la sesion, que es quien manda, y el texto en castellano seguira ahi.
const TUI_ONLY_DESCRIPTIONS: readonly SlashCommand[] = [
  curated('help', 'prompt.slash.desc.help'),
  curated('hooks', 'prompt.slash.desc.hooks'),
  curated('memory', 'prompt.slash.desc.memory'),
  curated('permissions', 'prompt.slash.desc.permissions'),
  curated('status', 'prompt.slash.desc.status'),
];

// Comandos curados indexados por nombre -> acceso O(1) al construir el catalogo (evita recorrer la lista por cada
// comando de la sesion). Guarda el comando, no el texto: la descripcion se lee (y traduce) al construir.
const CURATED_COMMANDS: ReadonlyMap<string, SlashCommand> = new Map(
  [...SLASH_COMMANDS, ...TUI_ONLY_DESCRIPTIONS].map((command) => [command.name, command]),
);

// Descripcion para un comando que la sesion ofrece y no esta en la lista curada. No se inventa lo que
// hace: se dice de donde viene. Los namespaced (`plugin:comando`) son de plugin/skill.
function describeDiscovered(name: string): string {
  return name.includes(':') ? t('prompt.slash.fromPlugin') : t('prompt.slash.fromSession');
}

// Catalogo EFECTIVO de comandos: los que la sesion declara. Normaliza (quita la barra si viniera,
// recorta, descarta vacios), deduplica y ordena alfabeticamente para que el popover sea determinista.
//
// Prioridad de la descripcion: (1) la que da el CLI —la respuesta al `initialize` las trae de verdad—,
// (2) la curada de Mage (en castellano, para los built-in), (3) una derivada del nombre. Asi el texto
// mas fiable gana, y nunca se queda una entrada sin nada que explicar.
//
// Si la sesion no ha reportado comandos todavia (arrancando, o un proveedor que no los
// manda), se cae a la lista curada: mejor un autocompletado aproximado que ninguno.
export function buildSlashCatalog(sessionCommands: readonly SlashCommand[]): readonly SlashCommand[] {
  const byName = new Map<string, SlashCommand>(); // nombre normalizado -> mejor entrada conocida
  for (const command of sessionCommands) {
    const name = command.name.trim().replace(/^\/+/, '');
    if (name.length === 0) continue;
    const fromCli = command.description.trim();
    byName.set(name, {
      name,
      description: fromCli.length > 0 ? fromCli : (CURATED_COMMANDS.get(name)?.description ?? describeDiscovered(name)),
      // La pista y los alias solo pueden venir del CLI: la lista curada no los tiene.
      argumentHint: emptyToNull(command.argumentHint),
      aliases: normalizeAliases(command.aliases, name),
    });
  }
  if (byName.size === 0) return SLASH_COMMANDS;
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Alias normalizados: sin barra, sin vacios, sin duplicados y sin el propio nombre (un alias igual al
// nombre haria que el comando saliera dos veces en el popover).
function normalizeAliases(aliases: readonly string[] | undefined, name: string): readonly string[] {
  if (aliases === undefined) return [];
  const clean = aliases.map((alias) => alias.trim().replace(/^\/+/, '')).filter((alias) => alias.length > 0 && alias !== name);
  return [...new Set(clean)];
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

// Devuelve las sugerencias para el texto actual del input, o [] si no procede mostrar el popover.
// Solo aplica cuando el texto es un unico token que empieza por '/' (sin espacios): "/co" -> filtra;
// "/compact algo" (ya hay argumento) o texto normal -> [].
// Ranking: primero los que EMPIEZAN por lo escrito, luego los que lo CONTIENEN (asi "/m" ofrece
// model/mcp/memory y "/re" ofrece rename y security-review). Tope SLASH_SUGGESTION_LIMIT.
// `catalog` es el catalogo efectivo de la sesion (ver buildSlashCatalog); por defecto, el curado.
export function filterSlashCommands(
  text: string,
  catalog: readonly SlashCommand[] = SLASH_COMMANDS,
): readonly SlashCommand[] {
  if (!text.startsWith('/')) return [];
  const query = text.slice(1);
  if (/\s/.test(query)) return []; // ya hay un argumento -> no es seleccion de comando
  const lower = query.toLowerCase();
  if (lower.length === 0) return catalog.slice(0, SLASH_SUGGESTION_LIMIT);
  // Se casa tambien contra los ALIAS (2.2), pero UNA sola vez por comando: si el nombre y un alias
  // casan a la vez, el comando sale una vez y en el grupo de prefijo, no dos veces.
  const namesOf = (command: SlashCommand): readonly string[] => [command.name, ...(command.aliases ?? [])];
  const startsWith = (command: SlashCommand): boolean => namesOf(command).some((n) => n.toLowerCase().startsWith(lower));
  const includes = (command: SlashCommand): boolean => namesOf(command).some((n) => n.toLowerCase().includes(lower));
  const prefix = catalog.filter(startsWith);
  const infix = catalog.filter((command) => !startsWith(command) && includes(command));
  return [...prefix, ...infix].slice(0, SLASH_SUGGESTION_LIMIT);
}

// Texto a insertar al elegir un comando: "/<name> " (con espacio, listo para el argumento).
export function completionFor(command: SlashCommand): string {
  return `/${command.name} `;
}

export interface SlashQuery {
  readonly start: number; // índice de la `/`
  readonly query: string; // lo escrito tras la `/` hasta el cursor
  readonly midSentence: boolean; // hay texto (no solo espacios) antes de la `/`
}

// Token `/…` bajo el cursor, como `mentionQueryAt`: la `/` va al inicio del texto o tras un espacio (así no
// dispara en `a/b` ni en una URL) y no hay espacios entre ella y el cursor. null si el cursor no está en uno.
export function slashQueryAt(text: string, cursor: number): SlashQuery | null {
  const end = Math.min(Math.max(cursor, 0), text.length);
  for (let i = end - 1; i >= 0; i -= 1) {
    const char = text.charAt(i);
    if (/\s/.test(char)) return null;
    if (char !== '/') continue;
    if (i > 0 && !/\s/.test(text.charAt(i - 1))) return null;
    return { start: i, query: text.slice(i + 1, end), midSentence: text.slice(0, i).trim().length > 0 };
  }
  return null;
}

// Sugerencias para el token `/` bajo el cursor. A mitad de frase el CLI no ejecuta un comando (le llega como
// texto), así que solo se ofrece lo que sirve como texto —skills, comandos de proyecto y de plugin—, no los
// internos del CLI que Mage conoce (`/clear`, `/rename`…).
export function slashSuggestionsAt(text: string, cursor: number, catalog: readonly SlashCommand[] = SLASH_COMMANDS): readonly SlashCommand[] {
  const at = slashQueryAt(text, cursor);
  if (at === null) return [];
  const pool = at.midSentence ? catalog.filter((command) => !CURATED_COMMANDS.has(command.name)) : catalog;
  return filterSlashCommands(`/${at.query}`, pool);
}

// Sustituye el token `/query` por `/name ` y deja el cursor tras el espacio (igual que `insertMention`).
export function insertSlashCommand(text: string, at: SlashQuery, command: SlashCommand): { readonly text: string; readonly cursor: number } {
  const completion = completionFor(command);
  const before = text.slice(0, at.start);
  const after = text.slice(at.start + 1 + at.query.length);
  return { text: `${before}${completion}${after}`, cursor: before.length + completion.length };
}
