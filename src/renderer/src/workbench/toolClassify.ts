// Clasificacion de herramientas por lo que HACEN (2.12.2). Es lo que decide dos cosas: el glifo de la
// caja y —lo importante— si la tool puede esconderse dentro de una racha-resumen.
//
// Modulo PURO y minusculo a proposito: la regla de agrupacion es una decision de producto y tiene que
// poder leerse (y testearse) de un vistazo, sin abrir un componente de React.

import type { IconName } from './components/Icon';

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

// Icono de la suite por clase (solo forma, monocroma: la misma regla que el registro de paneles). Es el
// respaldo de `iconForTool` cuando la herramienta concreta no tiene icono propio.
export const TOOL_CLASS_ICON: Readonly<Record<ToolClass, IconName>> = {
  read: 'toolRead',
  search: 'toolGrep',
  edit: 'toolEdit',
  command: 'toolBash',
  subagent: 'toolAgent',
  other: 'toolGeneric',
};
