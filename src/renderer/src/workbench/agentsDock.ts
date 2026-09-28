import type { Block } from './types';

// Estado de los subagentes del turno EN CURSO para el dock de encima del input (P-026 3.4, paso C). Sale
// de los bloques del store y no del panel «Subagentes» (ese lista definiciones, no ejecuciones). PURO y
// en una pasada: los pasos de cada subagente se atribuyen por `parentToolUseId`.

type SubagentBlock = Extract<Block, { kind: 'subagent' }>;
type ToolBlock = Extract<Block, { kind: 'tool' }>;

export type AgentRunState = 'running' | 'done' | 'error';

export interface AgentDockRow {
  readonly toolUseId: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: AgentRunState;
  readonly currentStep: string; // «Pensando…», «Ejecutando Grep…», «Terminado»
  readonly elapsedMs: number | null; // solo al terminar; en marcha lo mide el componente
}

export function agentsDockRows(blocks: readonly Block[]): readonly AgentDockRow[] {
  const subagents: SubagentBlock[] = [];
  const lastToolByParent = new Map<string, ToolBlock>();
  for (const block of blocks.slice(lastUserIndex(blocks) + 1)) {
    if (block.kind === 'subagent') subagents.push(block);
    if (block.kind === 'tool' && block.parentToolUseId !== null) lastToolByParent.set(block.parentToolUseId, block);
  }
  return subagents.map((sub) => {
    const state = runStateOf(sub);
    return {
      toolUseId: sub.toolUseId,
      name: sub.agentType ?? 'Subagente',
      description: sub.description,
      state,
      currentStep: currentStepOf(state, lastToolByParent.get(sub.toolUseId)),
      elapsedMs: sub.elapsedMs,
    };
  });
}

function lastUserIndex(blocks: readonly Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.kind === 'user') return i;
  }
  return -1;
}

function runStateOf(block: SubagentBlock): AgentRunState {
  if (block.status === null) return 'running';
  return block.status === 'error' ? 'error' : 'done';
}

// Una herramienta sin `meta` todavia no tiene resultado: es lo que esta haciendo ahora. Entre una y
// otra, el subagente esta pensando (sus pasos llegan como mensajes enteros, sin deltas: medido).
function currentStepOf(state: AgentRunState, lastTool: ToolBlock | undefined): string {
  if (state === 'done') return 'Terminado';
  if (state === 'error') return 'Falló';
  if (lastTool !== undefined && lastTool.meta.length === 0) return `Ejecutando ${lastTool.tool}…`;
  return 'Pensando…';
}
