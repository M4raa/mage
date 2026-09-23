// Agrupacion de las herramientas que la sesion cargo de verdad (`tools` del `session_init`), para el
// panel "Herramientas". PURO: datos -> datos. Mismo patron que `commandCatalogView.ts`.
//
// La regla la fija el propio nombre, que es el unico dato que hay: el CLI manda una lista plana de
// strings y no dice de donde sale cada una. Una herramienta de MCP se llama `mcp__<servidor>__<tool>`
// (convencion del protocolo, la misma que usa el CLI para nombrarlas); cualquier otra es nativa.

// Grupo de las herramientas nativas del agente (Read, Bash, Task…). Va SIEMPRE primero.
export const BUILTIN_GROUP = 'Nativas';

// Prefijo con el que el protocolo nombra las herramientas expuestas por un servidor MCP.
const MCP_PREFIX = 'mcp__';
const MCP_SEPARATOR = '__';

export interface ToolGroup {
  readonly origin: string;
  readonly tools: readonly ToolEntry[];
}

export interface ToolEntry {
  // Nombre COMPLETO, tal cual lo manda el CLI. Es lo que hay que poder copiar para una regla de
  // permisos o un `--allowedTools`, asi que no se pierde en ningun momento.
  readonly name: string;
  // Nombre corto para pintar dentro de su grupo: sin el `mcp__<servidor>__` que ya dice la cabecera.
  readonly label: string;
}

// Servidor MCP del que viene una herramienta, o null si es nativa. Exportada porque la regla de
// "que cuenta como herramienta de MCP" merece su propio nombre y sus propios casos.
export function mcpServerOf(name: string): string | null {
  if (!name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const cut = rest.indexOf(MCP_SEPARATOR);
  // `mcp__servidor` sin herramienta detras, o `mcp__` a secas: no hay servidor que nombrar, asi que se
  // trata como nativa en vez de inventar un grupo vacio o con nombre en blanco.
  if (cut <= 0) return null;
  return rest.slice(0, cut);
}

export function groupToolsByOrigin(tools: readonly string[]): readonly ToolGroup[] {
  const byOrigin = new Map<string, ToolEntry[]>();
  for (const name of tools) {
    const server = mcpServerOf(name);
    const origin = server ?? BUILTIN_GROUP;
    const label = server === null ? name : name.slice(MCP_PREFIX.length + server.length + MCP_SEPARATOR.length);
    const group = byOrigin.get(origin) ?? [];
    group.push({ name, label });
    byOrigin.set(origin, group);
  }
  // Orden estable: las nativas primero y los servidores en alfabetico; dentro, por nombre. Si dependiera
  // del orden de llegada, la lista bailaria entre sesiones con los mismos datos.
  return [...byOrigin.entries()]
    .sort(([a], [b]) => (a === BUILTIN_GROUP ? -1 : b === BUILTIN_GROUP ? 1 : a.localeCompare(b)))
    .map(([origin, group]) => ({ origin, tools: [...group].sort((a, b) => a.label.localeCompare(b.label)) }));
}

// Filtro del buscador: casa contra el nombre COMPLETO, no contra la etiqueta corta. Asi buscar
// "database" encuentra sus herramientas aunque el grupo ya las agrupe, que es lo que espera quien recuerda
// el servidor pero no el nombre exacto de la herramienta.
export function filterTools(tools: readonly string[], query: string): readonly string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return tools;
  return tools.filter((name) => name.toLowerCase().includes(needle));
}
