import type { IconName } from './components/Icon';
import { classifyTool, TOOL_CLASS_ICON } from './toolClassify';

// Icono propio de cada herramienta conocida (suite `tool*`). Lo que no este aqui cae al de su CLASE y, si
// tampoco tiene, a `toolGeneric`. Sin JSX a proposito: es un mapa puro y testeable (el plan lo llamaba
// toolIcons.tsx; no hace falta React para devolver un nombre).
const TOOL_ICONS: ReadonlyMap<string, IconName> = new Map<string, IconName>([
  ['Read', 'toolRead'],
  ['NotebookRead', 'toolRead'],
  ['Glob', 'toolGlob'],
  ['Grep', 'toolGrep'],
  ['Edit', 'toolEdit'],
  ['MultiEdit', 'toolEdit'],
  ['NotebookEdit', 'toolEdit'],
  ['Write', 'toolWrite'],
  ['Bash', 'toolBash'],
  ['BashOutput', 'toolBash'],
  ['KillShell', 'toolBash'],
  ['WebSearch', 'toolWebSearch'],
  ['WebFetch', 'toolWebFetch'],
  ['Task', 'toolAgent'],
  ['Agent', 'toolAgent'],
  ['TodoWrite', 'toolTodo'],
  ['AskUserQuestion', 'toolQuestion'],
]);

const MCP_PREFIX = 'mcp__';

export function iconForTool(toolName: string): IconName {
  const name = toolName.trim();
  const own = TOOL_ICONS.get(name);
  if (own !== undefined) return own;
  if (name.startsWith(MCP_PREFIX)) return 'toolMcp';
  return TOOL_CLASS_ICON[classifyTool(name)];
}
