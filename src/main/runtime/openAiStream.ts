import { CHAT_CHUNK_SCHEMA, type ChatChunk, type ToolCallDelta } from './chatSchemas';

// Lectura PURA del stream SSE de Chat Completions (OpenAI-compatible): partir el SSE, parsear cada
// trozo y reensamblar las tool calls. Sin red ni reloj: lo consume el runtime propio (`chatClient`).
// Medido en `spike/runtime-spike.mjs`.

// Contadores de tokens de una respuesta. Enteros: los tokens NO son decimales.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

// Lo que sale del stream, ya normalizado.
export type StreamPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'tool_call'; readonly call: AssembledToolCall }
  | { readonly kind: 'usage'; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly kind: 'finish'; readonly reason: FinishReason };

// Una tool call ya reensamblada. `id` null = el servidor no mando ninguno (lo pone quien la ejecuta).
export interface AssembledToolCall {
  readonly id: string | null;
  readonly name: string;
  readonly argumentsJson: string;
}

const DATA_PREFIX = 'data:';
const DONE_SENTINEL = '[DONE]';

// --- SSE -------------------------------------------------------------------------------------------

// Carga util de UNA linea SSE: el texto tras `data:`, o null si la linea no trae datos (vacia,
// comentario `:`, `event:`, o el centinela `[DONE]`).
export function sseData(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line.startsWith(DATA_PREFIX)) return null;
  const data = line.slice(DATA_PREFIX.length).trim();
  if (data.length === 0 || data === DONE_SENTINEL) return null;
  return data;
}

// Parte un stream SSE que llega en lecturas arbitrarias: una linea (o un caracter UTF-8 multibyte)
// puede quedar partida entre dos lecturas. Acepta bytes (los decodifica en modo stream) o texto ya
// decodificado. Devuelve las cargas `data:` completas, en orden.
export class SseDecoder {
  private readonly decoder = new TextDecoder('utf-8');
  private buffer = '';

  push(chunk: Uint8Array | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const payloads: string[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const data = sseData(this.buffer.slice(0, newline));
      if (data !== null) payloads.push(data);
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
    return payloads;
  }

  // Lo que quede sin salto de linea final (un servidor que cierra sin `\n`).
  end(): string[] {
    const rest = this.buffer + this.decoder.decode();
    this.buffer = '';
    const data = sseData(rest);
    return data === null ? [] : [data];
  }
}

// Parsea la carga de un trozo. JSON invalido o que no sea un objeto -> Error con el trozo en el mensaje.
export function parseChatChunk(data: string): ChatChunk {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch (err) {
    throw new Error(`Trozo del stream que no es JSON valido: ${JSON.stringify(data)} (${(err as Error).message})`);
  }
  const result = CHAT_CHUNK_SCHEMA.safeParse(raw);
  if (!result.success) throw new Error(`Trozo del stream con forma inesperada: ${JSON.stringify(data)}`);
  return result.data;
}

// --- Uso y motivo de parada ----------------------------------------------------------------------------

// Parseo SEGURO del bloque `usage` (puede venir ausente, null, con strings, decimales o negativos).
// null = no hay nada aprovechable, que NO es lo mismo que un uso de cero.
export function parseOpenAiUsage(raw: unknown): TokenUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const inputTokens = readTokenCount(record.prompt_tokens);
  const outputTokens = readTokenCount(record.completion_tokens);
  if (inputTokens === null && outputTokens === null) return null;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

function readTokenCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

// `finish_reason` -> vocabulario neutro. null = el trozo no lo trae.
export function parseFinishReason(raw: unknown): FinishReason | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw === 'tool_calls' || raw === 'function_call') return 'tool_calls';
  if (raw === 'stop' || raw === 'length') return raw;
  return 'other';
}

// --- Reensamblado de tool calls ------------------------------------------------------------------------

// Lo que un fragmento aporto a su llamada. `opened` = primer fragmento de esa llamada.
export interface ToolCallFragment {
  readonly slot: number;
  readonly opened: boolean;
  readonly id: string | null;
  readonly name: string;
  readonly argumentsDelta: string;
}

interface Slot {
  id: string | null;
  name: string;
  args: string;
}

// Acumula los fragmentos de las tool calls por `index` (el mismo acumulador vale para OpenAI, troceado
// y entrelazado, y para Ollama, entero en un trozo: medido en el spike). Sin `index`, por `id`; sin
// ninguno de los dos, el fragmento continua la ultima llamada abierta.
export class ToolCallAccumulator {
  private readonly slots: Slot[] = [];
  private readonly slotByKey = new Map<string, number>();

  add(delta: ToolCallDelta): ToolCallFragment {
    const id = nonEmpty(delta.id);
    const { slot, opened } = this.slotFor(delta.index, id);
    const entry = this.slots[slot]!;
    if (entry.id === null && id !== null) entry.id = id;
    const name = nonEmpty(delta.function?.name);
    if (entry.name.length === 0 && name !== null) entry.name = name;
    const argumentsDelta = delta.function?.arguments ?? '';
    entry.args += argumentsDelta;
    return { slot, opened, id: entry.id, name: entry.name, argumentsDelta };
  }

  get size(): number {
    return this.slots.length;
  }

  // Las llamadas en el orden en que se abrieron. Una sin nombre no es ejecutable ni reportable: se
  // descarta (es un fragmento suelto, no una llamada).
  calls(): AssembledToolCall[] {
    return this.slots
      .filter((slot) => slot.name.length > 0)
      .map((slot) => ({ id: slot.id, name: slot.name, argumentsJson: slot.args }));
  }

  private slotFor(index: number | undefined, id: string | null): { slot: number; opened: boolean } {
    const key = index !== undefined ? `i:${index}` : id !== null ? `id:${id}` : null;
    if (key === null) {
      if (this.slots.length > 0) return { slot: this.slots.length - 1, opened: false };
      return this.open(null);
    }
    const existing = this.slotByKey.get(key);
    if (existing !== undefined) return { slot: existing, opened: false };
    return this.open(key);
  }

  private open(key: string | null): { slot: number; opened: true } {
    const slot = this.slots.push({ id: null, name: '', args: '' }) - 1;
    if (key !== null) this.slotByKey.set(key, slot);
    return { slot, opened: true };
  }
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

// --- Parser de una respuesta completa ------------------------------------------------------------------

// Convierte los trozos de UNA respuesta en `StreamPart`. El texto sale en cuanto llega; las tool calls,
// el uso y el motivo de parada, al final (`end`), porque los argumentos llegan troceados y el uso puede
// venir en varios trozos (Gemini) o en uno final con `choices: []` (OpenAI): se toma el ultimo.
export class ChatStreamParser {
  private readonly tools = new ToolCallAccumulator();
  private readonly think = new ThinkTagSplitter();
  private usage: TokenUsage | null = null;
  private finish: FinishReason | null = null;

  push(chunk: ChatChunk): StreamPart[] {
    const usage = parseOpenAiUsage(chunk.usage);
    if (usage !== null) this.usage = usage;
    const choice = chunk.choices[0];
    if (choice === undefined) return [];
    const finish = parseFinishReason(choice.finish_reason);
    if (finish !== null) this.finish = finish;
    const parts: StreamPart[] = [];
    const delta = choice.delta;
    if (delta === undefined) return parts;
    const thinking = delta.reasoning_content ?? delta.reasoning;
    if (typeof thinking === 'string' && thinking.length > 0) parts.push({ kind: 'thinking', text: thinking });
    if (typeof delta.content === 'string' && delta.content.length > 0) parts.push(...this.think.push(delta.content));
    for (const call of delta.tool_calls ?? []) this.tools.add(call);
    return parts;
  }

  // Cierra la respuesta. Haber recibido llamadas implica `tool_calls` aunque el servidor diga `stop` o
  // no diga nada (versiones de Ollama cierran con `stop` tras una llamada): si no, el turno acabaria
  // con la llamada sin ejecutar.
  end(): StreamPart[] {
    const calls = this.tools.calls();
    const parts: StreamPart[] = [...this.think.end(), ...calls.map((call): StreamPart => ({ kind: 'tool_call', call }))];
    if (this.usage !== null) parts.push({ kind: 'usage', ...this.usage });
    const reason = calls.length > 0 && (this.finish === null || this.finish === 'stop') ? 'tool_calls' : (this.finish ?? 'stop');
    parts.push({ kind: 'finish', reason });
    return parts;
  }
}

// --- Razonamiento en etiquetas -------------------------------------------------------------------------

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

// Modelos Qwen/DeepSeek mandan el razonamiento DENTRO del contenido, entre `<think>` y `</think>`. Solo
// se trata como pensamiento si la respuesta EMPIEZA por la etiqueta (ficha D15b): un `<think>` en mitad
// del texto es texto. Las etiquetas pueden llegar partidas entre trozos, asi que se retiene lo justo.
export class ThinkTagSplitter {
  private state: 'start' | 'thinking' | 'text' = 'start';
  private pending = '';

  push(chunk: string): StreamPart[] {
    if (this.state === 'text') return [{ kind: 'text', text: chunk }];
    this.pending += chunk;
    if (this.state === 'start') return this.decideStart();
    return this.drainThinking();
  }

  // Lo retenido al cerrarse la respuesta: un `<think>` sin cerrar se da como pensamiento.
  end(): StreamPart[] {
    const rest = this.pending;
    this.pending = '';
    if (rest.length === 0) return [];
    return [{ kind: this.state === 'thinking' ? 'thinking' : 'text', text: rest }];
  }

  private decideStart(): StreamPart[] {
    const trimmed = this.pending.trimStart();
    if (trimmed.length < THINK_OPEN.length && THINK_OPEN.startsWith(trimmed)) return []; // aun no se sabe
    if (!trimmed.startsWith(THINK_OPEN)) {
      this.state = 'text';
      const text = this.pending;
      this.pending = '';
      return [{ kind: 'text', text }];
    }
    this.state = 'thinking';
    this.pending = trimmed.slice(THINK_OPEN.length);
    return this.drainThinking();
  }

  private drainThinking(): StreamPart[] {
    const close = this.pending.indexOf(THINK_CLOSE);
    if (close === -1) {
      // Se retiene la cola que podria ser el principio de `</think>`.
      const keep = partialSuffix(this.pending, THINK_CLOSE);
      const thought = this.pending.slice(0, this.pending.length - keep);
      this.pending = this.pending.slice(this.pending.length - keep);
      return thought.length === 0 ? [] : [{ kind: 'thinking', text: thought }];
    }
    const thought = this.pending.slice(0, close);
    const text = this.pending.slice(close + THINK_CLOSE.length).replace(/^\s+/, '');
    this.pending = '';
    this.state = 'text';
    return [...(thought.length === 0 ? [] : [{ kind: 'thinking' as const, text: thought }]), ...(text.length === 0 ? [] : [{ kind: 'text' as const, text }])];
  }
}

// Longitud del sufijo de `text` que es prefijo de `tag` (0 si ninguno).
function partialSuffix(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--) {
    if (tag.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}
