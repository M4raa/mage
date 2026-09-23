import type { SlashCommandInfo } from '@shared/events';

// Agrupacion del catalogo de comandos "/" por ORIGEN (2.9.b), para el panel "Comandos y skills".
// PURO: datos -> datos.
//
// La regla la fija el propio nombre: un comando namespaced (`itb-skills:itb-core`) viene del plugin o
// la skill que hay antes del PRIMER `:`; uno sin prefijo es propio de la sesion. No hay otra fuente —
// el CLI no dice de que plugin viene cada comando— asi que se deriva del unico dato que hay, y se dice.

// Grupo de los comandos sin prefijo. Va SIEMPRE el primero: son los del propio Claude Code.
export const SESSION_GROUP = 'Sesión';

export interface CommandGroup {
  readonly origin: string;
  readonly commands: readonly SlashCommandInfo[];
}

export function groupCommandsByOrigin(commands: readonly SlashCommandInfo[]): readonly CommandGroup[] {
  const byOrigin = new Map<string, SlashCommandInfo[]>();
  for (const command of commands) {
    const origin = originOf(command.name);
    const group = byOrigin.get(origin) ?? [];
    group.push(command);
    byOrigin.set(origin, group);
  }
  // Orden estable: el grupo de la sesion primero y el resto alfabetico; dentro, por nombre. Si dependiera
  // del orden de llegada, la lista bailaria entre refrescos del catalogo con los mismos datos.
  return [...byOrigin.entries()]
    .sort(([a], [b]) => (a === SESSION_GROUP ? -1 : b === SESSION_GROUP ? 1 : a.localeCompare(b)))
    .map(([origin, group]) => ({ origin, commands: [...group].sort((a, b) => a.name.localeCompare(b.name)) }));
}

// Origen de un comando: lo que hay antes del PRIMER `:`. Con varios (`itb-skills:itb-core:algo`) solo
// cuenta el primer segmento: los siguientes son del propio nombre del comando.
function originOf(name: string): string {
  const index = name.indexOf(':');
  return index <= 0 ? SESSION_GROUP : name.slice(0, index);
}

// Filtro del buscador del panel: casa contra el nombre, la descripcion y los alias, sin distinguir
// mayusculas. Vacio -> todo (no filtrar es lo que espera un buscador vacio).
export function filterCommands(commands: readonly SlashCommandInfo[], query: string): readonly SlashCommandInfo[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return commands;
  return commands.filter((command) =>
    [command.name, command.description, ...command.aliases].some((text) => text.toLowerCase().includes(needle)),
  );
}
