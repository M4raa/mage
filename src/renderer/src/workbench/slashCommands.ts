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
// (`cost`, `help`, `hooks`, `memory`, `permissions`, `status`) NO existen en el CLI headless — son de
// la TUI. Ofrecerlos era enganar al usuario: al enviarlos, el CLI los trata como texto normal y el
// modelo responde a un prompt que dice "/status".

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

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'agents', description: 'Gestiona los subagentes disponibles' },
  { name: 'clear', description: 'Empieza de cero (limpia el contexto)' },
  { name: 'compact', description: 'Compacta el contexto de la conversación' },
  { name: 'config', description: 'Configuración del CLI' },
  { name: 'context', description: 'Muestra en qué se gasta la ventana de contexto' },
  { name: 'doctor', description: 'Diagnostica la instalación de Claude Code' },
  { name: 'init', description: 'Genera/actualiza CLAUDE.md del proyecto' },
  { name: 'mcp', description: 'Servidores MCP conectados' },
  { name: 'model', description: 'Cambia el modelo de la sesión' },
  { name: 'review', description: 'Revisa los cambios pendientes' },
  { name: 'security-review', description: 'Revisión de seguridad de los cambios' },
  { name: 'usage', description: 'Uso de la suscripción (ventanas 5 h / semanal)' },
];

// Los 6 que D4 midio que NO existen en el CLI headless (son de la TUI). FUERA de `SLASH_COMMANDS` a
// proposito, porque esa lista es la que se OFRECE cuando la sesion aun no ha reportado los suyos — y
// como `ensureSession` es perezoso, ese es justo el estado de cualquier conversacion recien abierta:
// ofrecerlos ahi era engañar exactamente igual que ofrecerlos con la sesion viva (`pnpm verify:gui` lo
// encontro el 2026-08-12). Sus descripciones se conservan por si una version futura del CLI headless
// los declara: entonces vendran de la sesion, que es quien manda, y el texto en castellano seguira ahi.
const TUI_ONLY_DESCRIPTIONS: readonly SlashCommand[] = [
  { name: 'cost', description: 'Coste y tokens de la sesión actual' },
  { name: 'help', description: 'Ayuda de Claude Code' },
  { name: 'hooks', description: 'Gestiona los hooks del proyecto' },
  { name: 'memory', description: 'Edita los ficheros de memoria (CLAUDE.md)' },
  { name: 'permissions', description: 'Reglas de permisos del proyecto' },
  { name: 'status', description: 'Estado de la sesión (cuenta, modelo, versión)' },
];

// Descripciones curadas indexadas por nombre -> acceso O(1) al construir el catalogo (evita recorrer
// la lista por cada comando de la sesion).
const CURATED_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  [...SLASH_COMMANDS, ...TUI_ONLY_DESCRIPTIONS].map((command) => [command.name, command.description]),
);

// Descripcion para un comando que la sesion ofrece y no esta en la lista curada. No se inventa lo que
// hace: se dice de donde viene. Los namespaced (`plugin:comando`) son de plugin/skill.
function describeDiscovered(name: string): string {
  return name.includes(':') ? 'Comando de un plugin o skill' : 'Comando propio de esta sesión';
}

// Catalogo EFECTIVO de comandos: los que la sesion declara. Normaliza (quita la barra si viniera,
// recorta, descarta vacios), deduplica y ordena alfabeticamente para que el popover sea determinista.
//
// Prioridad de la descripcion: (1) la que da el CLI —la respuesta al `initialize` las trae de verdad—,
// (2) la curada de Mage (en castellano, para los built-in), (3) una derivada del nombre. Asi el texto
// mas fiable gana, y nunca se queda una entrada sin nada que explicar.
//
// Si la sesion no ha reportado comandos todavia (arrancando, o un proveedor por gateway que no los
// manda), se cae a la lista curada: mejor un autocompletado aproximado que ninguno.
export function buildSlashCatalog(sessionCommands: readonly SlashCommand[]): readonly SlashCommand[] {
  const byName = new Map<string, SlashCommand>(); // nombre normalizado -> mejor entrada conocida
  for (const command of sessionCommands) {
    const name = command.name.trim().replace(/^\/+/, '');
    if (name.length === 0) continue;
    const fromCli = command.description.trim();
    byName.set(name, {
      name,
      description: fromCli.length > 0 ? fromCli : (CURATED_DESCRIPTIONS.get(name) ?? describeDiscovered(name)),
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
// model/mcp/memory y "/rev" ofrece review y security-review). Tope SLASH_SUGGESTION_LIMIT.
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
