// Clasificacion de herramientas por lo que HACEN (2.12.2). Es lo que decide dos cosas: el glifo de la
// caja y —lo importante— si la tool puede esconderse dentro de una racha-resumen.
//
// Modulo PURO y minusculo a proposito: la regla de agrupacion es una decision de producto y tiene que
// poder leerse (y testearse) de un vistazo, sin abrir un componente de React.

export type ToolClass = 'read' | 'search' | 'edit' | 'command' | 'subagent' | 'other';

// Catalogo por nombre exacto. Lo que no este aqui cae en 'other' y por tanto NO agrupa: esconder algo
// que no sabemos que es seria peor que dejarlo a la vista (decision §0.1). Las MCP (`mcp__*`) entran
// justo por ahi.
const TOOL_CLASSES: ReadonlyMap<string, ToolClass> = new Map([
  ['Read', 'read'],
  ['NotebookRead', 'read'],
  ['Glob', 'search'],
  ['Grep', 'search'],
  ['WebSearch', 'search'],
  ['WebFetch', 'search'],
  ['Edit', 'edit'],
  ['MultiEdit', 'edit'],
  ['Write', 'edit'],
  ['NotebookEdit', 'edit'],
  ['Bash', 'command'],
  ['BashOutput', 'command'],
  ['KillShell', 'command'],
  ['Task', 'subagent'],
  ['Agent', 'subagent'],
]);

export function classifyTool(toolName: string): ToolClass {
  return TOOL_CLASSES.get(toolName.trim()) ?? 'other';
}

// Glifo por clase. MONOCROMO a proposito (misma regla que el registro de paneles): un emoji de color
// se sale de la paleta del tema y no conmuta con el.
export const TOOL_CLASS_GLYPH: Readonly<Record<ToolClass, string>> = {
  read: '◇',
  search: '⌕',
  edit: '✎',
  command: '›_',
  subagent: '⇲',
  other: '▣',
};
