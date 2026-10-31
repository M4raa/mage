import { Buffer } from 'node:buffer';
import { DEFAULT_MAX_RESULT_BYTES, readInputSchema, readOutputSchema } from './schemas';
import type { PublicMessage, ReadOutput } from './types';

// maxBytes cuenta SOLO UTF-8 de los textos; quedan fuera los metadatos JSON del protocolo.
export function createResultPage(input: { messages: readonly PublicMessage[]; afterSeq?: number; maxBytes?: number }): ReadOutput {
  const validated = readInputSchema.parse({ conversationId: 'page', afterSeq: input.afterSeq, maxBytes: input.maxBytes });
  const afterSeq = validated.afterSeq ?? 0;
  let remaining = validated.maxBytes ?? DEFAULT_MAX_RESULT_BYTES;
  const messages: PublicMessage[] = [];
  let nextSeq = afterSeq;
  let truncated = false;
  for (const message of input.messages) {
    if (message.seq <= afterSeq) continue;
    const fits = Buffer.byteLength(message.text, 'utf8') <= remaining;
    const text = fits ? message.text : utf8Prefix(message.text, remaining);
    if (fits || text.length > 0) {
      messages.push({ seq: message.seq, role: message.role, text });
      nextSeq = message.seq;
      remaining -= Buffer.byteLength(text, 'utf8');
    }
    if (fits) continue;
    truncated = true;
    break;
  }
  return readOutputSchema.parse({ messages, nextSeq, truncated });
}
function utf8Prefix(text: string, budget: number): string {
  let used = 0;
  const prefix: string[] = [];
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (used + bytes > budget) break;
    prefix.push(character);
    used += bytes;
  }
  return prefix.join('');
}
