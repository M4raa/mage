import { z } from 'zod';
import { textualToolResult } from './agentLoop';
import type { ChatMessage, ChatToolCall } from './chatClient';
import { compactedHistory } from './compaction';

// Reconstruye los mensajes de Chat Completions de una transcripcion JSONL (la del runtime o una antigua
// del gateway, que escribio el CLI de Claude en el mismo formato) para REANUDAR. PURO.
//
// Reglas: `tool_use` -> `assistant.tool_calls`, `tool_result` -> `role: 'tool'`. El CLI parte un
// mensaje del asistente en varias lineas (una por bloque): las consecutivas se funden. Se reparan los
// huecos que el protocolo no admite (una llamada sin resultado, tras un corte, recibe uno).
//
// Una vuelta marcada `mageTextual` (llamadas escritas en el texto por un modelo sin herramientas
// nativas) se rehace como en memoria: el asistente solo con su texto y los resultados como un mensaje
// del usuario (M3 de la revision). Lo que se lee pasa por Zod tolerante (M7): un campo de otra forma se
// ignora, nunca llega a la peticion.

export interface ResumedTranscript {
  readonly messages: ChatMessage[];
  readonly lastUuid: string | null;
  readonly warnings: string[];
}

const MISSING_RESULT = 'Sin resultado: la conversación se cortó antes de que terminara.';

const LINE_SCHEMA = z
  .object({
    type: z.string().optional().catch(undefined),
    subtype: z.string().optional().catch(undefined),
    uuid: z.string().optional().catch(undefined),
    isSidechain: z.boolean().optional().catch(undefined),
    isMeta: z.boolean().optional().catch(undefined),
    mageTextual: z.boolean().optional().catch(undefined),
    message: z
      .object({ content: z.union([z.string(), z.array(z.unknown())]).optional().catch(undefined) })
      .passthrough()
      .optional()
      .catch(undefined),
    mageCompaction: z.object({ summary: z.string(), tail: z.array(z.unknown()) }).optional().catch(undefined),
  })
  .passthrough();
type Line = z.infer<typeof LINE_SCHEMA>;

const TEXT_BLOCK = z.object({ type: z.literal('text'), text: z.string() });
const TOOL_USE_BLOCK = z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown().optional() });
const TOOL_RESULT_BLOCK = z.object({ type: z.literal('tool_result'), tool_use_id: z.string(), content: z.unknown().optional() });

const TOOL_CALL_SCHEMA = z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) });
const CHAT_MESSAGE_SCHEMA = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({ role: z.literal('assistant'), content: z.string().nullable(), tool_calls: z.array(TOOL_CALL_SCHEMA).optional() }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string(), content: z.string() }),
]);

interface AssistantDraft {
  text: string;
  calls: ChatToolCall[];
  textual: boolean;
}

interface ResumeState {
  readonly messages: ChatMessage[];
  readonly warnings: string[];
  // Llamadas escritas como texto: id -> nombre (sus resultados vuelven como mensaje del usuario).
  readonly textualCalls: Map<string, string>;
  // El ultimo mensaje de resultados escritos, para juntar los de la misma vuelta en uno.
  lastTextualResults: ChatMessage | null;
  draft: AssistantDraft | null;
}

export function transcriptToMessages(lines: readonly string[]): ResumedTranscript {
  const state: ResumeState = { messages: [], warnings: [], textualCalls: new Map(), lastTextualResults: null, draft: null };
  let lastUuid: string | null = null;
  lines.forEach((raw, index) => {
    if (raw.trim().length === 0) return;
    const line = parseLine(raw, index, state.warnings);
    if (line === null) return;
    if (line.uuid !== undefined) lastUuid = line.uuid;
    if (line.isSidechain === true || line.isMeta === true) return;
    applyLine(state, line);
  });
  flush(state);
  return { messages: repair(state.messages), lastUuid, warnings: state.warnings };
}

function applyLine(state: ResumeState, line: Line): void {
  if (line.type === 'system' && line.subtype === 'compact_boundary' && line.mageCompaction !== undefined) {
    // Lo anterior a una compactacion lo sustituye su resumen (con la cola que se conservo).
    state.draft = null;
    state.lastTextualResults = null;
    state.messages.splice(0, state.messages.length, ...compactedHistory(line.mageCompaction.summary, validTail(line.mageCompaction.tail, state.warnings)));
    return;
  }
  if (line.type === 'assistant') {
    state.draft ??= { text: '', calls: [], textual: false };
    appendAssistant(state.draft, line);
  } else if (line.type === 'user') {
    flush(state);
    appendUser(state, line);
  }
}

function validTail(tail: readonly unknown[], warnings: string[]): ChatMessage[] {
  const valid: ChatMessage[] = [];
  for (const entry of tail) {
    const parsed = CHAT_MESSAGE_SCHEMA.safeParse(entry);
    if (parsed.success) valid.push(parsed.data);
    else warnings.push(`Un mensaje de la cola compactada no tiene forma de mensaje: se ignora (${parsed.error.issues[0]?.message ?? 'forma desconocida'})`);
  }
  return valid;
}

function parseLine(raw: string, index: number, warnings: string[]): Line | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Lo normal es la ULTIMA linea cortada por un cierre a mitad de escritura: se avisa, no se silencia.
    warnings.push(`Línea ${index + 1} de la transcripción no es JSON válido: se ignora`);
    return null;
  }
  const line = LINE_SCHEMA.safeParse(parsed);
  if (line.success) return line.data;
  warnings.push(`Línea ${index + 1} de la transcripción no es un objeto: se ignora`);
  return null;
}

function contentOf(line: Line): string | readonly unknown[] | undefined {
  return line.message?.content;
}

function appendAssistant(draft: AssistantDraft, line: Line): void {
  if (line.mageTextual === true) draft.textual = true;
  const content = contentOf(line);
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const text = TEXT_BLOCK.safeParse(block);
    if (text.success) draft.text += text.data.text;
    const use = TOOL_USE_BLOCK.safeParse(block);
    if (use.success) draft.calls.push({ id: use.data.id, type: 'function', function: { name: use.data.name, arguments: JSON.stringify(use.data.input ?? {}) } });
  }
}

function flush(state: ResumeState): void {
  const draft = state.draft;
  state.draft = null;
  if (draft === null) return;
  if (!draft.textual || draft.calls.length === 0) {
    state.messages.push(assistantOf(draft));
    return;
  }
  for (const call of draft.calls) state.textualCalls.set(call.id, call.function.name);
  state.messages.push({ role: 'assistant', content: draft.text });
}

function appendUser(state: ResumeState, line: Line): void {
  const content = contentOf(line);
  if (typeof content === 'string') {
    if (content.length > 0) pushUser(state, content);
    return;
  }
  if (!Array.isArray(content)) return;
  let text = '';
  for (const block of content) {
    const result = TOOL_RESULT_BLOCK.safeParse(block);
    if (result.success) appendResult(state, result.data.tool_use_id, flattenContent(result.data.content));
    const plain = TEXT_BLOCK.safeParse(block);
    if (plain.success) text += plain.data.text;
  }
  if (text.length > 0) pushUser(state, text);
}

function pushUser(state: ResumeState, content: string): void {
  state.lastTextualResults = null;
  state.messages.push({ role: 'user', content });
}

function appendResult(state: ResumeState, id: string, output: string): void {
  const name = state.textualCalls.get(id);
  if (name === undefined) {
    state.messages.push({ role: 'tool', tool_call_id: id, content: output });
    return;
  }
  // Los resultados escritos de una misma vuelta van juntos en UN mensaje del usuario, como en memoria.
  const piece = textualToolResult(name, output);
  const last = state.lastTextualResults;
  const merged: ChatMessage = { role: 'user', content: last === null ? piece : `${last.content}\n${piece}` };
  if (last !== null && state.messages.at(-1) === last) state.messages[state.messages.length - 1] = merged;
  else state.messages.push(merged);
  state.lastTextualResults = merged;
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => TEXT_BLOCK.omit({ type: true }).safeParse(part)).map((part) => (part.success ? part.data.text : '')).join('');
}

function assistantOf(draft: AssistantDraft): ChatMessage {
  if (draft.calls.length === 0) return { role: 'assistant', content: draft.text };
  return { role: 'assistant', content: draft.text.length === 0 ? null : draft.text, tool_calls: draft.calls };
}

// Cada `tool_calls` va seguido de un `tool` por id, en orden; un `tool` suelto (sin llamada) sobra.
function repair(messages: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === 'tool') continue; // los legitimos los coloca su assistant
    out.push(message);
    if (message.role !== 'assistant' || message.tool_calls === undefined) continue;
    const results = new Map<string, string>();
    for (let j = i + 1; j < messages.length && messages[j]!.role === 'tool'; j++) {
      const tool = messages[j] as Extract<ChatMessage, { role: 'tool' }>;
      results.set(tool.tool_call_id, tool.content);
    }
    for (const call of message.tool_calls) out.push({ role: 'tool', tool_call_id: call.id, content: results.get(call.id) ?? MISSING_RESULT });
  }
  return out;
}
