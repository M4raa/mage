import type { Block } from './types';
import type { TextState } from './promptEditing';

// Historial de prompts del editor con ↑/↓, como el CLI: los mensajes enviados en ESTA conversación, del más reciente al
// más antiguo. PURO: la barra guarda el estado y aplica el texto. Solo vuelve el texto, no los adjuntos.
export interface PromptHistoryState {
  readonly index: number | null; // posición en las entradas del mensaje que se enseña; null = sin recorrer
  readonly savedDraft: string; // el borrador de antes de empezar a recorrer
}
export const IDLE_PROMPT_HISTORY: PromptHistoryState = { index: null, savedDraft: '' };
export interface PromptHistoryMove { readonly state: PromptHistoryState; readonly text: TextState }

// Mensajes del usuario, del más reciente al más antiguo, sin vacíos ni repetidos seguidos.
export function sentPrompts(blocks: readonly Block[]): readonly string[] {
  const entries: string[] = [];
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block === undefined || block.kind !== 'user' || block.text.trim().length === 0) continue;
    if (entries.at(-1) !== block.text) entries.push(block.text);
  }
  return entries;
}

export function caretOnFirstLine(state: TextState): boolean {
  return !state.value.slice(0, state.selectionStart).includes('\n');
}

export function caretOnLastLine(state: TextState): boolean {
  return !state.value.slice(state.selectionEnd).includes('\n');
}

const caretAt = (value: string, caret: number): TextState => ({ value, selectionStart: caret, selectionEnd: caret });

// ↑: en la primera línea, con el borrador vacío o igual al mensaje que ya se enseña, el anterior. null = la tecla sigue a CodeMirror.
export function historyUp(entries: readonly string[], history: PromptHistoryState, current: TextState): PromptHistoryMove | null {
  if (!caretOnFirstLine(current)) return null;
  const index = history.index;
  const browsing = index !== null && entries[index] === current.value;
  if (!browsing && current.value.trim().length > 0) return null;
  const next = browsing ? index + 1 : 0;
  const text = entries[next];
  if (text === undefined) return null;
  return { state: { index: next, savedDraft: browsing ? history.savedDraft : current.value }, text: caretAt(text, 0) };
}

// ↓: en la última línea y con el mensaje recordado intacto, el siguiente; tras el más reciente, el borrador de antes.
export function historyDown(entries: readonly string[], history: PromptHistoryState, current: TextState): PromptHistoryMove | null {
  const index = history.index;
  if (index === null || entries[index] !== current.value || !caretOnLastLine(current)) return null;
  if (index === 0) return { state: IDLE_PROMPT_HISTORY, text: caretAt(history.savedDraft, history.savedDraft.length) };
  const text = entries[index - 1] ?? '';
  return { state: { index: index - 1, savedDraft: history.savedDraft }, text: caretAt(text, text.length) };
}
