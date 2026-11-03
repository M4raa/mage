import { codexContentText, isCodexInjectedContext, type CodexTurn } from '@shared/codexTranscript';
import type { TranscriptEntry } from '@shared/transcripts';

// Resolucion PURA de los puntos de rewind: de la burbuja de usuario que pinta el renderer al mensaje nativo.
// Sin fs, sin log y sin Date: recibe la rama activa (Claude) o los turnos (Codex) ya leidos.

// Lo que identifica una burbuja de usuario en el renderer (D-K2).
export interface RewindPointRef {
  readonly userIndex: number;
  readonly text: string;
  readonly nativeId: string | null;
}

export type RewindPointErrorReason = 'not_found' | 'mid_turn' | 'empty';

export class RewindPointError extends Error {
  constructor(readonly reason: RewindPointErrorReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'RewindPointError';
  }
}

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeRef(ref: RewindPointRef): string {
  return `userIndex=${ref.userIndex} nativeId=${ref.nativeId === null ? 'null' : ref.nativeId}`;
}

// ---------------------------------------------------------------- Claude

export interface ClaudePrompt {
  readonly uuid: string;
  // Posicion de la entrada en el array de la rama que se le dio a `claudePrompts`.
  readonly entryIndex: number;
  readonly text: string;
}

// Texto de un mensaje real del usuario: el string, o los bloques `text` unidos con '\n'. null si no lo es
// (vacio, sin bloques `text` o con algun `tool_result`).
function promptText(content: unknown): string | null {
  if (typeof content === 'string') return content.length > 0 ? content : null;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => isRec(block) && block.type === 'tool_result')) return null;
  const texts = content.flatMap((block) => (isRec(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));
  return texts.length > 0 ? texts.join('\n') : null;
}

function claudePromptOf(entry: TranscriptEntry, entryIndex: number): ClaudePrompt | null {
  if (entry.kind !== 'user' || entry.isMeta || entry.isSidechain || entry.uuid === null) return null;
  const message = isRec(entry.raw) ? entry.raw.message : undefined;
  const text = isRec(message) ? promptText(message.content) : null;
  return text === null ? null : { uuid: entry.uuid, entryIndex, text };
}

// Mensajes reales del usuario de la rama activa (no resultados de herramienta, ni meta, ni sidechain).
export function claudePrompts(entries: readonly TranscriptEntry[]): readonly ClaudePrompt[] {
  return entries.flatMap((entry, i) => {
    const prompt = claudePromptOf(entry, i);
    return prompt === null ? [] : [prompt];
  });
}

export function resolveClaudePoint(prompts: readonly ClaudePrompt[], ref: RewindPointRef): ClaudePrompt {
  const found = ref.nativeId === null ? undefined : prompts.find((prompt) => prompt.uuid === ref.nativeId);
  if (found === undefined) throw new RewindPointError('not_found', describeRef(ref));
  return found;
}

// uuid del ultimo mensaje de usuario de la rama.
export function claudeLastSeen(prompts: readonly ClaudePrompt[]): string {
  const last = prompts.at(-1);
  if (last === undefined) throw new RewindPointError('empty', 'la rama no tiene mensajes de usuario');
  return last.uuid;
}

// Hoja del fork (U2: incluye el mensaje y su respuesta): la ULTIMA entrada user|assistant con uuid que va despues
// del punto y antes del siguiente prompt (o, si es el ultimo prompt, hasta el final de la rama). Sin respuesta,
// el propio mensaje.
export function claudeForkLeaf(entries: readonly TranscriptEntry[], prompts: readonly ClaudePrompt[], point: ClaudePrompt): string {
  const at = prompts.findIndex((prompt) => prompt.uuid === point.uuid);
  if (at < 0) throw new RewindPointError('not_found', `uuid=${point.uuid}`);
  const end = prompts[at + 1]?.entryIndex ?? entries.length;
  let leaf = point.uuid;
  for (let i = point.entryIndex + 1; i < end; i += 1) {
    const entry = entries[i];
    if (entry !== undefined && entry.uuid !== null && (entry.kind === 'user' || entry.kind === 'assistant')) leaf = entry.uuid;
  }
  return leaf;
}

// ---------------------------------------------------------------- Codex

export interface CodexUserMessage {
  readonly turnId: string;
  readonly itemId: string;
  readonly clientId: string | null;
  readonly text: string;
  readonly opensTurn: boolean;
}

function codexUserMessageOf(turn: CodexTurn, item: unknown, opensTurn: boolean): CodexUserMessage | null {
  if (!isRec(item) || item.type !== 'userMessage' || typeof item.id !== 'string') return null;
  const text = codexContentText(item.content);
  if (isCodexInjectedContext(text)) return null;
  return { turnId: turn.id, itemId: item.id, clientId: typeof item.clientId === 'string' ? item.clientId : null, text, opensTurn };
}

// Los items `userMessage` de los turnos, en orden y sin los de contexto inyectado. `opensTurn`: el primero de su turno.
export function codexUserMessages(turns: readonly CodexTurn[]): readonly CodexUserMessage[] {
  return turns.flatMap((turn) => {
    const out: CodexUserMessage[] = [];
    for (const item of turn.items) {
      const message = codexUserMessageOf(turn, item, out.length === 0);
      if (message !== null) out.push(message);
    }
    return out;
  });
}

// 1) nativeId que coincide con clientId o itemId; 2) si no, el de posicion `userIndex` con el MISMO texto (trim).
// Uno que no abre su turno (un directo) no se puede rebobinar: el corte es por turno.
export function resolveCodexPoint(messages: readonly CodexUserMessage[], ref: RewindPointRef): CodexUserMessage {
  const found = findCodexPoint(messages, ref);
  if (found === undefined) throw new RewindPointError('not_found', describeRef(ref));
  if (!found.opensTurn) throw new RewindPointError('mid_turn', `itemId=${found.itemId} (${describeRef(ref)})`);
  return found;
}

function findCodexPoint(messages: readonly CodexUserMessage[], ref: RewindPointRef): CodexUserMessage | undefined {
  const { nativeId } = ref;
  const byId = nativeId === null ? undefined : messages.find((m) => m.clientId === nativeId || m.itemId === nativeId);
  if (byId !== undefined) return byId;
  const byIndex = messages[ref.userIndex];
  return byIndex !== undefined && byIndex.text.trim() === ref.text.trim() ? byIndex : undefined;
}

// ---------------------------------------------------------------- Comun

// Cuantos mensajes de usuario se descartan desde el punto (incluido).
export function discardedFrom<T>(list: readonly T[], point: T): number {
  const at = list.indexOf(point);
  if (at < 0) throw new Error(`El punto no esta en la lista de mensajes (${list.length}): ${JSON.stringify(point)}`);
  return list.length - at;
}
