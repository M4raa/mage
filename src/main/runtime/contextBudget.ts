import type { ContextUsage } from '@shared/events';
import type { ChatMessage } from './chatClient';

// Presupuesto de la ventana de contexto de UNA sesion del runtime propio (P-032 §4.7, ficha D14). PURO.
//   - Estima tokens con chars/4 y lo RECALIBRA con el `usage` real de cada vuelta, si llega (un factor
//     por sesion). Sin tokenizador: basta para decidir cuando recortar.
//   - Antes de cada peticion: si no cabe, recorta la salida de las herramientas ANTIGUAS a una linea; si
//     sigue sin caber, lanza `ContextOverflowError` (nunca se manda a ciegas para comerse un 400).
//   - Da el `context_usage` que pinta la UI, con el maximo del modelo.

export const CHARS_PER_TOKEN = 4;
// Lo que se deja libre para la respuesta del modelo.
export const RESERVE_TOKENS = 1_024;
// Por encima de esta ocupacion del limite util (ventana - reserva) se avisa (§8.1 D8: avisar y luego resumir).
export const CONTEXT_WARN_RATIO = 0.8;
// Las ultimas N salidas de herramienta nunca se recortan: son las que el modelo esta usando.
const KEEP_RECENT_TOOL_OUTPUTS = 2;
// Margen del factor de recalibrado: un `usage` raro no puede disparar la estimacion.
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 3;
// Lo que cuesta un mensaje aparte de su texto (rol, separadores de la plantilla).
const MESSAGE_OVERHEAD_TOKENS = 4;

export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

export class ContextBudget {
  private factor = 1;
  private lastEstimate: number | null = null;

  constructor(
    readonly window: number,
    private readonly model: string,
  ) {
    if (!Number.isInteger(window) || window <= RESERVE_TOKENS) {
      throw new Error(`Ventana de contexto invalida para ${model}: ${window} (tiene que ser un entero mayor que ${RESERVE_TOKENS})`);
    }
  }

  get limit(): number {
    return this.window - RESERVE_TOKENS;
  }

  estimate(messages: readonly ChatMessage[]): number {
    const raw = messages.reduce((total, message) => total + rawTokens(message), 0);
    return Math.ceil(raw * this.factor);
  }

  // Ajusta el factor con lo que el servidor conto DE VERDAD para la ultima peticion `fit`eada.
  recalibrate(actualInputTokens: number): void {
    if (!Number.isInteger(actualInputTokens) || actualInputTokens <= 0 || this.lastEstimate === null || this.lastEstimate <= 0) return;
    const raw = this.lastEstimate / this.factor;
    this.factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, actualInputTokens / raw));
  }

  // Los mensajes que caben en la ventana (recortando herramientas antiguas), o lanza.
  fit(messages: readonly ChatMessage[]): readonly ChatMessage[] {
    let current = messages;
    if (this.estimate(current) > this.limit) current = trimOldToolOutputs(current);
    const estimate = this.estimate(current);
    this.lastEstimate = estimate;
    if (estimate > this.limit) {
      throw new ContextOverflowError(
        `La conversación no cabe en la ventana de ${this.window} tokens de ${this.model} (ocupa unos ${estimate}). ` +
          'Usa /clear o sube el contexto del modelo en su proveedor.',
      );
    }
    return current;
  }

  usage(messages: readonly ChatMessage[]): ContextUsage {
    const system = messages.filter((message) => message.role === 'system');
    const rest = messages.filter((message) => message.role !== 'system');
    const systemTokens = this.estimate(system);
    const messageTokens = this.estimate(rest);
    const total = Math.min(this.window, systemTokens + messageTokens);
    return {
      totalTokens: total,
      maxTokens: this.window,
      percentage: Math.round((total / this.window) * 100),
      categories: [
        { name: 'System prompt', tokens: systemTokens, isDeferred: false },
        { name: 'Messages', tokens: messageTokens, isDeferred: false },
        { name: 'Free space', tokens: Math.max(0, this.window - total), isDeferred: false },
      ],
    };
  }

  // ¿Ha cruzado el umbral de aviso?
  isNearLimit(messages: readonly ChatMessage[]): boolean {
    return this.estimate(messages) >= this.limit * CONTEXT_WARN_RATIO;
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function rawTokens(message: ChatMessage): number {
  const content = message.content ?? '';
  const calls = message.role === 'assistant' ? (message.tool_calls ?? []).reduce((total, call) => total + call.function.name.length + call.function.arguments.length, 0) : 0;
  return estimateTokens(content) + Math.ceil(calls / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD_TOKENS;
}

// Deja en una linea las salidas de herramienta salvo las ultimas: el modelo ya las uso y lo que importa
// es que sabe que estuvieron.
function trimOldToolOutputs(messages: readonly ChatMessage[]): ChatMessage[] {
  const toolIndexes = messages.flatMap((message, index) => (message.role === 'tool' ? [index] : []));
  const old = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - KEEP_RECENT_TOOL_OUTPUTS)));
  return messages.map((message, index) => {
    if (!old.has(index) || message.role !== 'tool') return message;
    const firstLine = message.content.split('\n', 1)[0] ?? '';
    return { ...message, content: `[salida recortada para caber en el contexto: ${message.content.length} caracteres] ${firstLine.slice(0, 120)}` };
  });
}
