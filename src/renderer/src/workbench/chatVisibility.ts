import { artifactCardFrom } from './artifactView';
import { isSubagentRunning } from './engineBlocks';
import { formatElapsed } from './thinkingStatus';
import type { IconName } from './components/Icon';
import { iconForTool } from './toolIcons';
import { shortToolCommand } from './toolSummary';
import type { Block } from './types';

// Que va al CHAT y que al panel de ACTIVIDAD (P-026 3.4, D21–D24). El chat es el orquestador: lo que se
// dice (usuario, agente —tambien su texto intermedio, D21b—, errores, avisos), un permiso que espera
// respuesta y los artifacts publicados. Lo que se HACE —herramientas, pensamiento, subagentes, permisos
// ya resueltos (D23) y preguntas ya contestadas (D16)— va al panel, paso a paso. PURO: una pasada.

type ToolBlock = Extract<Block, { kind: 'tool' }>;
type SubagentBlock = Extract<Block, { kind: 'subagent' }>;

export function isChatBlock(block: Block): boolean {
  switch (block.kind) {
    case 'user':
    case 'agent':
    case 'error':
    case 'system':
    case 'command-output':
      return true;
    case 'permission':
      return block.state === 'pending';
    case 'tool':
      return artifactCardFrom(block) !== null;
    default:
      return false;
  }
}

// Una herramienta del agente PRINCIPAL que fallo deja una linea en el chat (D22); las de un subagente
// no, su fallo lo cuenta el resumen de sus subagentes.
export function isFailedMainTool(block: Block): block is ToolBlock {
  return block.kind === 'tool' && block.isError && block.parentToolUseId === null && artifactCardFrom(block) === null;
}

export type ChatRow =
  | { readonly kind: 'block'; readonly block: Block }
  | { readonly kind: 'tool-failed'; readonly block: ToolBlock }
  // Los subagentes que lanzo el orquestador en un turno, en UNA linea (D21), donde salio el primero.
  | { readonly kind: 'subagents'; readonly id: string; readonly blocks: readonly SubagentBlock[] };

export function chatRows(blocks: readonly Block[]): readonly ChatRow[] {
  const rows: ChatRow[] = [];
  let group: { kind: 'subagents'; id: string; blocks: SubagentBlock[] } | null = null;
  for (const block of blocks) {
    if (block.kind === 'user') group = null; // los subagentes se agrupan por turno
    if (block.kind === 'subagent') {
      if (group === null) {
        group = { kind: 'subagents', id: `subagents-${block.id}`, blocks: [] };
        rows.push(group);
      }
      group.blocks.push(block);
    } else if (isFailedMainTool(block)) {
      rows.push({ kind: 'tool-failed', block });
    } else if (isChatBlock(block)) {
      rows.push({ kind: 'block', block });
    }
  }
  return rows;
}

// Lo que va al panel: todo lo que no es del chat, menos un permiso que aun espera (ese esta en el chat) y
// una pregunta pendiente (esa esta en el dock).
export function isActivityStep(block: Block): boolean {
  if (block.kind === 'tool') return artifactCardFrom(block) === null;
  if (block.kind === 'permission' || block.kind === 'question') return block.state !== 'pending';
  return block.kind === 'thinking' || block.kind === 'subagent';
}

export function isStepError(block: Block): boolean {
  if (block.kind === 'tool') return block.isError;
  if (block.kind === 'subagent') return block.status === 'error';
  return false;
}

export interface ActivityTurn {
  readonly turnIndex: number; // 0 = pasos antes del primer mensaje del usuario
  readonly userPreview: string;
  readonly steps: readonly Block[];
}

const PREVIEW_CHARS = 60;

// Turnos del panel: se corta en cada mensaje del usuario, en una pasada. Un turno sin pasos no sale.
export function activityTurns(blocks: readonly Block[]): readonly ActivityTurn[] {
  const turns: { turnIndex: number; userPreview: string; steps: Block[] }[] = [];
  let current = { turnIndex: 0, userPreview: '', steps: [] as Block[] };
  for (const block of blocks) {
    if (block.kind === 'user') {
      if (current.steps.length > 0) turns.push(current);
      current = { turnIndex: current.turnIndex + 1, userPreview: previewOf(block.text), steps: [] };
    } else if (isActivityStep(block)) {
      current.steps.push(block);
    }
  }
  if (current.steps.length > 0) turns.push(current);
  return turns;
}

function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

// Pasos y errores del turno EN CURSO (desde el ultimo mensaje del usuario): la linea de estado del chat.
export function currentTurnSummary(blocks: readonly Block[]): { readonly steps: number; readonly errors: number } {
  let steps = 0;
  let errors = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block === undefined || block.kind === 'user') break;
    if (!isActivityStep(block)) continue;
    steps += 1;
    if (isStepError(block)) errors += 1;
  }
  return { steps, errors };
}

// Lo que dice una fila del panel. Una herramienta de subagente va sangrada (`nested`).
export interface ActivityStepLabel {
  readonly icon: IconName;
  readonly name: string;
  readonly detail: string;
  readonly meta: string;
  readonly isError: boolean;
  readonly nested: boolean;
}

const DECISION_LABEL: Readonly<Record<string, string>> = {
  allowed: 'permitido',
  denied: 'denegado',
  cancelled: 'cancelado',
  answered: 'contestada',
  pending: 'pendiente',
};

export function activityStepLabel(block: Block): ActivityStepLabel {
  const base = { isError: isStepError(block), nested: false };
  switch (block.kind) {
    case 'tool':
      return {
        ...base,
        icon: iconForTool(block.tool),
        name: block.tool,
        detail: shortToolCommand(block.tool, block.command),
        meta: block.meta.length > 0 ? block.meta : '…',
        nested: block.parentToolUseId !== null,
      };
    case 'thinking':
      return { ...base, icon: 'brain', name: 'Pensamiento', detail: previewOf(runsText(block.runs)), meta: block.elapsedMs === null ? '' : formatElapsed(block.elapsedMs) };
    case 'subagent':
      return { ...base, icon: 'toolAgent', name: block.agentType ?? 'Subagente', detail: block.description ?? '', meta: block.status ?? 'en marcha' };
    case 'permission':
      return { ...base, icon: 'shield', name: `Permiso · ${block.toolName}`, detail: block.target, meta: DECISION_LABEL[block.state] ?? block.state };
    case 'question':
      return { ...base, icon: 'question', name: 'Pregunta', detail: previewOf(block.questions[0]?.question ?? ''), meta: DECISION_LABEL[block.state] ?? block.state };
    default:
      return { ...base, icon: 'diamond', name: block.kind, detail: '', meta: '' };
  }
}

function isStepRunning(block: Block): boolean {
  switch (block.kind) {
    case 'tool':
      return block.meta === ''; // igual que `activityStepLabel`, que lo pinta como '…'
    case 'thinking':
      return block.elapsedMs === null;
    case 'subagent':
      // Sin resultado, o lanzado en segundo plano y sin notificacion (W-J, P-028 37a: el bloque guarda
      // 'en segundo plano', no el `async_launched` crudo del CLI).
      return isSubagentRunning(block);
    default:
      return false;
  }
}

// Id del paso EN MARCHA de un turno (el ultimo que lo este), o null. Solo con `turnLive`: un turno
// interrumpido deja herramientas con `meta` vacio para siempre y no hay nada corriendo. PURO.
export function runningStepId(turn: ActivityTurn, turnLive: boolean): string | null {
  if (!turnLive) return null;
  for (let i = turn.steps.length - 1; i >= 0; i -= 1) {
    const step = turn.steps[i];
    if (step !== undefined && isStepRunning(step)) return step.id;
  }
  return null;
}

export function runsText(runs: readonly { readonly text: string }[]): string {
  return runs.map((r) => r.text).join('');
}

// Clave de reinicio del pegado al fondo (puntos 13 y 25): cambia al cambiar de pestana, al pasar de
// chat vacio a con contenido (hidratacion tras reanudar) y al llegar un mensaje nuevo del usuario.
export function stickResetKey(tabId: string, blocks: readonly Block[]): string {
  const lastUser = blocks.findLast((block) => block.kind === 'user');
  return `${tabId}:${blocks.length > 0}:${lastUser?.id ?? ''}`;
}
