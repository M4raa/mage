import type { ChatMessage, ChatToolCall } from './chatClient';

// Reconstruye los mensajes de Chat Completions de una transcripcion JSONL (la del runtime o una antigua
// del gateway, que escribio el CLI de Claude en el mismo formato) para REANUDAR. PURO.
//
// Reglas: `tool_use` -> `assistant.tool_calls`, `tool_result` -> `role: 'tool'`. El CLI parte un
// mensaje del asistente en varias lineas (una por bloque): las consecutivas se funden. Se reparan los
// huecos que el protocolo no admite (una llamada sin resultado, tras un corte, recibe uno).

export interface ResumedTranscript {
  readonly messages: ChatMessage[];
  readonly lastUuid: string | null;
  readonly warnings: string[];
}

const MISSING_RESULT = 'Sin resultado: la conversación se cortó antes de que terminara.';

interface AssistantDraft {
  text: string;
  calls: ChatToolCall[];
}

export function transcriptToMessages(lines: readonly string[]): ResumedTranscript {
  const messages: ChatMessage[] = [];
  const warnings: string[] = [];
  let lastUuid: string | null = null;
  let draft: AssistantDraft | null = null;
  const flush = () => {
    if (draft !== null) messages.push(assistantOf(draft));
    draft = null;
  };
  lines.forEach((raw, index) => {
    if (raw.trim().length === 0) return;
    const line = parseLine(raw, index, warnings);
    if (line === null) return;
    if (typeof line.uuid === 'string') lastUuid = line.uuid;
    if (line.isSidechain === true || line.isMeta === true) return;
    if (line.type === 'assistant') {
      draft ??= { text: '', calls: [] };
      appendAssistant(draft, line);
    } else if (line.type === 'user') {
      flush();
      messages.push(...userMessages(line));
    }
  });
  flush();
  return { messages: repair(messages), lastUuid, warnings };
}

function parseLine(raw: string, index: number, warnings: string[]): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    warnings.push(`Línea ${index + 1} de la transcripción no es un objeto: se ignora`);
  } catch {
    // Lo normal es la ULTIMA linea cortada por un cierre a mitad de escritura: se avisa, no se silencia.
    warnings.push(`Línea ${index + 1} de la transcripción no es JSON válido: se ignora`);
  }
  return null;
}

function contentOf(line: Record<string, unknown>): unknown {
  const message = line.message;
  return typeof message === 'object' && message !== null ? (message as { content?: unknown }).content : undefined;
}

function appendAssistant(draft: AssistantDraft, line: Record<string, unknown>): void {
  const content = contentOf(line);
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') draft.text += record.text;
    if (record.type === 'tool_use' && typeof record.id === 'string' && typeof record.name === 'string') {
      draft.calls.push({ id: record.id, type: 'function', function: { name: record.name, arguments: JSON.stringify(record.input ?? {}) } });
    }
  }
}

function userMessages(line: Record<string, unknown>): ChatMessage[] {
  const content = contentOf(line);
  if (typeof content === 'string') return content.length === 0 ? [] : [{ role: 'user', content }];
  if (!Array.isArray(content)) return [];
  const out: ChatMessage[] = [];
  let text = '';
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record.type === 'tool_result' && typeof record.tool_use_id === 'string') {
      out.push({ role: 'tool', tool_call_id: record.tool_use_id, content: flattenContent(record.content) });
    } else if (record.type === 'text' && typeof record.text === 'string') text += record.text;
  }
  return text.length > 0 ? [...out, { role: 'user', content: text }] : out;
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .join('');
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
