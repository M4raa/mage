import type { Block } from './types';
import { isSubagentRunning, SUBAGENT_STATUS } from './engineBlocks';
import { t } from '../i18n/uiLanguage';
import type { Translate } from '@shared/i18n/translator';

// Estado de los subagentes del turno EN CURSO para el dock de encima del input (P-026 3.4, paso C). Sale
// de los bloques del store y no del panel «Subagentes» (ese lista definiciones, no ejecuciones). PURO y
// en una pasada: los pasos de cada subagente se atribuyen por `parentToolUseId`.
//
// Entran los del turno en curso y, ademas, los que SIGAN en marcha de turnos anteriores (P-028 37a): un
// subagente en segundo plano sobrevive al turno que lo lanzo, y un mensaje nuevo no lo termina.

type SubagentBlock = Extract<Block, { kind: 'subagent' }>;
type ToolBlock = Extract<Block, { kind: 'tool' }>;

export type AgentRunState = 'running' | 'done' | 'error' | 'stopped';

export interface AgentDockRow {
  readonly toolUseId: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: AgentRunState;
  readonly currentStep: string; // «Pensando…», «Ejecutando Grep…», «Terminado»
  readonly elapsedMs: number | null; // solo al terminar; en marcha lo mide el componente
  // Para el panel de agentes (P-028 38): con que abrir su transcripcion, y lo que cuenta el CLI.
  readonly agentId: string | null;
  readonly tokens: number | null;
  readonly toolUses: number | null;
  readonly model: string | null;
}

// Cuantos siguen y cuantos pararon, para la linea agregada del dock (P-028 38).
export interface AgentsDockSummary {
  readonly running: number;
  readonly finished: number;
}

export function summarizeAgentsDock(rows: readonly AgentDockRow[]): AgentsDockSummary {
  const running = rows.filter((row) => row.state === 'running').length;
  return { running, finished: rows.length - running };
}

// «9 en ejecución · 2 terminados»; se omite la parte que vale cero.
// `translate` se inyecta para que quien memoriza el resultado lo rehaga al cambiar el idioma; por defecto, el activo.
export function agentsDockSummaryText({ running, finished }: AgentsDockSummary, translate: Translate = t): string {
  const parts: string[] = [];
  if (running > 0) parts.push(translate('chat.agents.summaryRunning', { count: running }));
  if (finished > 0) parts.push(translate('chat.agents.summaryFinished', { count: finished }));
  return parts.join(' · ');
}

// `dismissed`: los que el usuario quito del dock (P-028 37c). Uno en marcha no se puede quitar, asi que
// solo se filtran los que ya pararon.
const NONE: ReadonlySet<string> = new Set();

export function agentsDockRows(blocks: readonly Block[], dismissed: ReadonlySet<string> = NONE, translate: Translate = t): readonly AgentDockRow[] {
  const turnStart = lastUserIndex(blocks) + 1;
  return collectRows(blocks, (block, index) => isDockable(block, index >= turnStart, dismissed), translate);
}

// TODOS los subagentes de la conversacion, en orden de lanzamiento: la lista del panel de agentes (P-028
// 38), que sustituye a la que se leia de disco. Tras la hidratacion dice lo mismo que en vivo.
export function conversationAgentRows(blocks: readonly Block[], translate: Translate = t): readonly AgentDockRow[] {
  return collectRows(blocks, () => true, translate);
}

function collectRows(blocks: readonly Block[], include: (block: SubagentBlock, index: number) => boolean, translate: Translate): readonly AgentDockRow[] {
  const subagents: SubagentBlock[] = [];
  const lastToolByParent = new Map<string, ToolBlock>();
  blocks.forEach((block, index) => {
    if (block.kind === 'subagent' && include(block, index)) subagents.push(block);
    if (block.kind === 'tool' && block.parentToolUseId !== null) lastToolByParent.set(block.parentToolUseId, block);
  });
  return subagents.map((sub) => toRow(sub, lastToolByParent.get(sub.toolUseId), translate));
}

function toRow(sub: SubagentBlock, lastTool: ToolBlock | undefined, translate: Translate): AgentDockRow {
  const state = runStateOf(sub);
  return {
    toolUseId: sub.toolUseId,
    name: sub.agentType ?? translate('chat.activity.subagentFallback'),
    description: sub.description,
    state,
    currentStep: currentStepOf(state, lastTool, translate),
    elapsedMs: sub.elapsedMs,
    agentId: sub.agentId,
    tokens: sub.tokens,
    toolUses: sub.toolUses,
    model: sub.model,
  };
}

function isDockable(block: SubagentBlock, inCurrentTurn: boolean, dismissed: ReadonlySet<string>): boolean {
  if (isSubagentRunning(block)) return true;
  return inCurrentTurn && !dismissed.has(block.toolUseId);
}

// Un mensaje con el turno en marcha espera en la cola de Mage (0.1.1 R2, punto 30) y no llega a ser
// bloque: cada bloque `user` abre turno.
function lastUserIndex(blocks: readonly Block[]): number {
  return blocks.findLastIndex((block) => block.kind === 'user');
}

function runStateOf(block: SubagentBlock): AgentRunState {
  if (isSubagentRunning(block)) return 'running';
  if (block.status === SUBAGENT_STATUS.error) return 'error';
  return block.status === SUBAGENT_STATUS.stopped ? 'stopped' : 'done';
}

// Una herramienta sin `meta` todavia no tiene resultado: es lo que esta haciendo ahora. Entre una y
// otra, el subagente esta pensando (sus pasos llegan como mensajes enteros, sin deltas: medido).
function currentStepOf(state: AgentRunState, lastTool: ToolBlock | undefined, translate: Translate): string {
  if (state === 'done') return translate('chat.agents.stepDone');
  if (state === 'error') return translate('chat.agents.stepError');
  if (state === 'stopped') return translate('chat.agents.stepStopped');
  if (lastTool !== undefined && lastTool.meta.length === 0) return translate('chat.agents.stepRunningTool', { tool: lastTool.tool });
  return translate('chat.agents.stepThinking');
}
