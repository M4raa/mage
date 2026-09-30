// Traduccion del stream SSE de un proveedor OpenAI-compatible al SSE de la Messages API de Anthropic,
// que es lo que el CLI de Claude espera cuando se le apunta a nuestro gateway.
//
// Vive aparte de gateway.ts (que es I/O de red puro) para que TODA la logica de traduccion sea pura y
// testeable: la clase no toca la red ni el reloj, solo consume lineas y devuelve las lineas SSE a
// escribir. Antes esta logica estaba embebida en el handler de la respuesta HTTP y no tenia ni un test.

// Contadores de tokens de un turno. Enteros: los tokens NO son decimales.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

// Motivo de parada en vocabulario Anthropic.
type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

// Parseo SEGURO del bloque `usage` del proveedor (frontera externa: puede venir ausente, null, con
// strings, con decimales o con negativos). Devuelve null si no hay nada aprovechable, para que el
// llamante distinga "el proveedor no mando uso" de "el uso fue cero" — que es justo la diferencia que
// el gateway borraba al escribir 0 siempre.
export function parseOpenAiUsage(raw: unknown): TokenUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const inputTokens = readTokenCount(record.prompt_tokens);
  const outputTokens = readTokenCount(record.completion_tokens);
  if (inputTokens === null && outputTokens === null) return null;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

// Un contador de tokens valido es un entero >= 0. Cualquier otra cosa (string, decimal, negativo,
// NaN, Infinity) se descarta en vez de propagarse como un numero basura al panel de Uso.
function readTokenCount(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

// `finish_reason` de OpenAI -> `stop_reason` de Anthropic. Un valor desconocido cae a 'end_turn': es
// el unico neutro, y el turno termino de todas formas.
export function mapFinishReason(finishReason: unknown): StopReason | null {
  if (typeof finishReason !== 'string' || finishReason.length === 0) return null;
  if (finishReason === 'tool_calls' || finishReason === 'function_call') return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  return 'end_turn';
}

// Bloque de contenido abierto en el mensaje Anthropic que estamos construyendo.
interface OpenBlock {
  readonly index: number;
  readonly kind: 'text' | 'tool_use';
}

export interface TranslatorResult {
  // Lineas SSE listas para escribir (cada una ya termina en '\n\n').
  readonly lines: readonly string[];
}

// Traductor con estado de UN turno. Uso: `push(line)` por cada linea del SSE del proveedor y `finish()`
// al cerrarse la respuesta. Ambos devuelven las lineas a escribir (posiblemente ninguna).
export class AnthropicStreamTranslator {
  private messageStarted = false;
  private nextBlockIndex = 0;
  private textBlock: OpenBlock | null = null;
  // Indice de bloque Anthropic por indice de tool call del proveedor. Los indices del proveedor son su
  // propio espacio de numeracion y NO se pueden usar como indices de bloque: con texto + varias tools
  // colisionarian entre si (el codigo anterior los mezclaba).
  private readonly toolBlocks = new Map<number, OpenBlock>();
  private capturedUsage: TokenUsage | null = null;
  private stopReason: StopReason | null = null;
  private modelName: string | null = null;
  private finished = false;
  // Lineas del proveedor que no se pudieron parsear. NO se ignoran en silencio: se cuentan y el
  // gateway las reporta, porque una racha de estas significa respuesta truncada o formato inesperado.
  private malformedLines = 0;

  constructor(private readonly messageId: string, private readonly fallbackModel: string) {}

  get malformed(): number {
    return this.malformedLines;
  }

  // Uso realmente observado en el stream (null si el proveedor no mando ninguno).
  get usage(): TokenUsage | null {
    return this.capturedUsage;
  }

  // Consume una linea CRUDA del SSE del proveedor. Tolera lineas vacias, comentarios y el centinela
  // `[DONE]`; cualquier otra cosa que no sea JSON valido incrementa el contador de malformadas.
  push(rawLine: string): TranslatorResult {
    const line = rawLine.trim();
    if (line.length === 0 || !line.startsWith('data:')) return { lines: [] };
    const data = line.slice('data:'.length).trim();
    if (data.length === 0 || data === '[DONE]') return { lines: [] };

    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      this.malformedLines += 1;
      return { lines: [] };
    }
    return this.consumeChunk(chunk);
  }

  private consumeChunk(chunk: unknown): TranslatorResult {
    if (typeof chunk !== 'object' || chunk === null) {
      this.malformedLines += 1;
      return { lines: [] };
    }
    const record = chunk as Record<string, unknown>;

    // El uso puede venir en CUALQUIER chunk (Gemini lo manda en varios; OpenAI solo en el ultimo, y
    // solo si se pidio `stream_options.include_usage`). Nos quedamos con el ultimo no nulo.
    const usage = parseOpenAiUsage(record.usage);
    if (usage !== null) this.capturedUsage = usage;
    if (typeof record.model === 'string' && record.model.length > 0) this.modelName = record.model;

    const choice = readFirstChoice(record.choices);
    if (choice === null) return { lines: [] };

    const finish = mapFinishReason(choice.finish_reason);
    if (finish !== null) this.stopReason = finish;

    const delta = choice.delta;
    if (typeof delta !== 'object' || delta === null) return { lines: [] };
    const deltaRecord = delta as Record<string, unknown>;

    const lines: string[] = [];
    this.ensureMessageStart(lines);
    this.emitTextDelta(deltaRecord.content, lines);
    this.emitToolCallDeltas(deltaRecord.tool_calls, lines);
    return { lines };
  }

  // Cierra el mensaje: bloques abiertos, message_delta con el uso REAL y message_stop. Idempotente.
  finish(): TranslatorResult {
    if (this.finished) return { lines: [] };
    this.finished = true;
    const lines: string[] = [];
    // Un stream que no emitio ni un chunk util sigue necesitando un mensaje bien formado.
    this.ensureMessageStart(lines);
    this.closeOpenBlocks(lines);

    const usage = this.capturedUsage ?? ZERO_USAGE;
    lines.push(
      sse({
        type: 'message_delta',
        delta: { stop_reason: this.resolveStopReason(), stop_sequence: null },
        // input_tokens viaja aqui porque en el momento del message_start todavia no se conocia: el
        // proveedor OpenAI-compatible no manda el uso hasta el final del stream.
        usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
      }),
    );
    lines.push(sse({ type: 'message_stop' }));
    return { lines };
  }

  // Si el proveedor no mando finish_reason, se infiere: haber abierto una tool implica que el turno
  // acaba pidiendo una herramienta.
  private resolveStopReason(): StopReason {
    if (this.stopReason !== null) return this.stopReason;
    return this.toolBlocks.size > 0 ? 'tool_use' : 'end_turn';
  }

  private ensureMessageStart(lines: string[]): void {
    if (this.messageStarted) return;
    this.messageStarted = true;
    lines.push(
      sse({
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          model: this.modelName ?? this.fallbackModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          // Placeholder obligatorio del esquema: el uso real va en el message_delta final.
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    );
  }

  private emitTextDelta(content: unknown, lines: string[]): void {
    if (typeof content !== 'string' || content.length === 0) return;
    if (this.textBlock === null) {
      this.textBlock = { index: this.nextBlockIndex++, kind: 'text' };
      lines.push(
        sse({ type: 'content_block_start', index: this.textBlock.index, content_block: { type: 'text', text: '' } }),
      );
    }
    lines.push(
      sse({
        type: 'content_block_delta',
        index: this.textBlock.index,
        delta: { type: 'text_delta', text: content },
      }),
    );
  }

  private emitToolCallDeltas(toolCalls: unknown, lines: string[]): void {
    if (!Array.isArray(toolCalls)) return;
    for (const entry of toolCalls) {
      if (typeof entry !== 'object' || entry === null) continue;
      this.emitToolCallDelta(entry as Record<string, unknown>, lines);
    }
  }

  private emitToolCallDelta(call: Record<string, unknown>, lines: string[]): void {
    const providerIndex = typeof call.index === 'number' && Number.isInteger(call.index) ? call.index : 0;
    const fn = typeof call.function === 'object' && call.function !== null ? (call.function as Record<string, unknown>) : {};
    const id = typeof call.id === 'string' && call.id.length > 0 ? call.id : null;

    // Chunk de APERTURA: trae el id de la tool call. Antes de abrir el bloque de tool hay que cerrar el
    // de texto, porque Anthropic no admite dos bloques abiertos a la vez.
    if (id !== null && !this.toolBlocks.has(providerIndex)) {
      this.closeTextBlock(lines);
      const block: OpenBlock = { index: this.nextBlockIndex++, kind: 'tool_use' };
      this.toolBlocks.set(providerIndex, block);
      lines.push(
        sse({
          type: 'content_block_start',
          index: block.index,
          content_block: {
            type: 'tool_use',
            id,
            name: typeof fn.name === 'string' ? fn.name : '',
            input: {},
          },
        }),
      );
    }

    // Chunks de CONTINUACION: fragmentos del JSON de argumentos.
    const args = fn.arguments;
    if (typeof args !== 'string' || args.length === 0) return;
    const block = this.toolBlocks.get(providerIndex);
    if (block === undefined) return; // argumentos sin apertura previa: nada donde colgarlos
    lines.push(
      sse({
        type: 'content_block_delta',
        index: block.index,
        delta: { type: 'input_json_delta', partial_json: args },
      }),
    );
  }

  private closeTextBlock(lines: string[]): void {
    if (this.textBlock === null) return;
    lines.push(sse({ type: 'content_block_stop', index: this.textBlock.index }));
    this.textBlock = null;
  }

  private closeOpenBlocks(lines: string[]): void {
    this.closeTextBlock(lines);
    for (const block of this.toolBlocks.values()) {
      lines.push(sse({ type: 'content_block_stop', index: block.index }));
    }
  }
}

// Primer `choice` del chunk, o null si no hay ninguno utilizable.
function readFirstChoice(choices: unknown): Record<string, unknown> | null {
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  return first as Record<string, unknown>;
}

// Serializa un evento como linea SSE (el doble salto de linea es parte del formato), con su linea
// `event:`, que NO es decorativa: el SDK del CLI despacha el SSE de la Messages API por el NOMBRE del
// evento y descarta los que no lo traen. Sin ella el turno llegaba vacio (medido con
// `verify:gui --turn=local`, CLI 2.1.286: solo el bloque del usuario, ningun texto del asistente).
function sse(event: { readonly type: string; readonly [field: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// --- Respuesta NO streaming ------------------------------------------------------------------------

// Traduce una respuesta completa (no streaming) de OpenAI al formato de mensaje de Anthropic.
// Puro: el gateway solo se encarga de escribirlo.
export function translateOpenAiResponse(raw: unknown, messageId: string, fallbackModel: string): unknown {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Respuesta del proveedor no es un objeto: ${JSON.stringify(raw)}`);
  }
  const record = raw as Record<string, unknown>;
  const choice = readFirstChoice(record.choices);
  if (choice === null) {
    throw new Error('La respuesta del proveedor no trae ningun choice');
  }
  const message = typeof choice.message === 'object' && choice.message !== null
    ? (choice.message as Record<string, unknown>)
    : {};

  const content: unknown[] = [];
  if (typeof message.content === 'string' && message.content.length > 0) {
    content.push({ type: 'text', text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const entry of message.tool_calls) {
      const block = toToolUseBlock(entry);
      if (block !== null) content.push(block);
    }
  }

  const usage = parseOpenAiUsage(record.usage) ?? ZERO_USAGE;
  const stopReason = mapFinishReason(choice.finish_reason) ?? (content.some(isToolUse) ? 'tool_use' : 'end_turn');

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    model: typeof record.model === 'string' && record.model.length > 0 ? record.model : fallbackModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
  };
}

function isToolUse(block: unknown): boolean {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use';
}

// Una tool call de OpenAI -> bloque tool_use de Anthropic. Los argumentos vienen como STRING JSON; si no
// parsea se deja `{}` en vez de tumbar toda la respuesta (el modelo puede haber emitido JSON invalido).
function toToolUseBlock(entry: unknown): unknown | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const call = entry as Record<string, unknown>;
  const fn = typeof call.function === 'object' && call.function !== null ? (call.function as Record<string, unknown>) : {};
  const id = typeof call.id === 'string' ? call.id : '';
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (id.length === 0 || name.length === 0) return null;
  return { type: 'tool_use', id, name, input: parseToolArguments(fn.arguments) };
}

function parseToolArguments(args: unknown): Record<string, unknown> {
  if (typeof args !== 'string' || args.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(args);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // JSON de argumentos invalido del modelo: se entrega input vacio en vez de romper el turno entero.
    return {};
  }
}
