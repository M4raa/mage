import type { ChatMessage } from './chatClient';

// Compactacion por resumen del runtime propio (§8.1 D8 de P-032: avisar y luego resumir, con el propio
// modelo). PURO: decide por donde cortar, como se le pide el resumen y como queda el historial.

// Lo que se conserva tal cual al compactar: los mensajes mas recientes hasta esta fraccion del limite.
export const KEEP_RECENT_RATIO = 0.35;
// El texto de lo antiguo que se manda a resumir, como fraccion del limite (en caracteres: x4).
const SUMMARY_INPUT_RATIO = 0.7;
const CHARS_PER_TOKEN = 4;
const TOOL_OUTPUT_IN_SUMMARY_MAX = 400;

export const SUMMARY_SYSTEM_PROMPT =
  'You compress conversations. Write a concise summary of the conversation below so that an assistant can ' +
  'continue it: the user goals, decisions taken, files and commands involved, results, and what is still pending. ' +
  'Use the language of the conversation. Output only the summary.';

export const SUMMARY_PREFIX = '[Resumen de la conversación anterior, hecho por Mage para que quepa en el contexto]';

export interface CompactionSplit {
  readonly head: readonly ChatMessage[];
  readonly tail: readonly ChatMessage[];
}

// Corta el historial (sin el prompt de sistema) en lo que se resume y lo que se conserva. El corte cae
// SIEMPRE justo antes de un mensaje del usuario: nunca separa una llamada de su resultado. null = no
// hay nada que resumir (todo es reciente o solo hay un mensaje del usuario).
export function splitForCompaction(history: readonly ChatMessage[], keepTokens: number, estimate: (messages: readonly ChatMessage[]) => number): CompactionSplit | null {
  const userIndexes = history.flatMap((message, index) => (message.role === 'user' ? [index] : []));
  // De la ultima frontera a la primera: la que deje la cola mas larga que aun quepa en `keepTokens`.
  let cut: number | null = null;
  for (let i = userIndexes.length - 1; i >= 1; i--) {
    const candidate = userIndexes[i]!;
    if (estimate(history.slice(candidate)) > keepTokens) break;
    cut = candidate;
  }
  // Si ni el ultimo intercambio cabe entero, se corta en el ultimo mensaje del usuario igualmente.
  cut ??= userIndexes.length >= 2 ? userIndexes.at(-1)! : null;
  if (cut === null || cut === 0) return null;
  return { head: history.slice(0, cut), tail: history.slice(cut) };
}

// Lo antiguo como TEXTO plano: el resumen se pide sin herramientas, y unos `tool_calls` sueltos sin
// `tools` en la peticion los rechazan algunos servidores.
export function summaryRequest(head: readonly ChatMessage[], limitTokens: number): ChatMessage[] {
  const transcript = head.map(describe).join('\n\n');
  const maxChars = Math.floor(limitTokens * SUMMARY_INPUT_RATIO * CHARS_PER_TOKEN);
  const clipped = transcript.length > maxChars ? `[…]\n${transcript.slice(transcript.length - maxChars)}` : transcript;
  return [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: `Conversation to summarize:\n\n${clipped}` },
  ];
}

// El historial compactado: el resumen como intercambio (usuario + acuse) y despues la cola intacta, para
// no romper las plantillas que exigen alternar usuario y asistente.
export function compactedHistory(summary: string, tail: readonly ChatMessage[]): ChatMessage[] {
  return [
    { role: 'user', content: `${SUMMARY_PREFIX}\n\n${summary.trim()}` },
    { role: 'assistant', content: 'Entendido: sigo a partir de este resumen.' },
    ...tail,
  ];
}

function describe(message: ChatMessage): string {
  switch (message.role) {
    case 'system':
      return `System: ${message.content}`;
    case 'user':
      return `User: ${message.content}`;
    case 'assistant': {
      const calls = (message.tool_calls ?? []).map((call) => `[calls ${call.function.name} ${call.function.arguments}]`);
      return `Assistant: ${[message.content ?? '', ...calls].filter((part) => part.length > 0).join(' ')}`;
    }
    case 'tool':
      return `Tool result: ${message.content.slice(0, TOOL_OUTPUT_IN_SUMMARY_MAX)}`;
  }
}
