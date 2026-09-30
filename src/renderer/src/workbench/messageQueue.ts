import type { ImageAttachment } from '@shared/ipc';
import { base64ByteLength } from '@shared/attachments';
import { shiftImageTokens } from '@shared/imageRefs';
import type { PromptDraft } from './types';

// Cola de mensajes de Mage (0.1.1 R2, punto 30). Con un turno en marcha, Enter ya NO escribe en el stdin
// del CLI (que lo metia DENTRO del turno en curso): el mensaje espera aqui, por pestaña, y sale como turno
// propio cuando el turno acaba. Uno por turno y en orden. Un Stop no la envia: la devuelve al input.
// PURO: el store decide cuando encolar y cuando sacar; aqui solo esta la forma de la cola.

export interface QueuedMessage {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly ImageAttachment[];
}

// Separador entre mensajes al devolverlos al input: el mismo parrafo en blanco que usa el resto del prompt.
const JOIN = '\n\n';

export function enqueueMessage(queue: readonly QueuedMessage[], message: QueuedMessage): readonly QueuedMessage[] {
  if (message.id.length === 0) throw new Error(`Mensaje en cola sin id: ${JSON.stringify(message.text.slice(0, 40))}`);
  return [...queue, message];
}

// El primero sale; el resto espera al turno siguiente.
export function takeNextMessage(queue: readonly QueuedMessage[]): { readonly next: QueuedMessage | null; readonly rest: readonly QueuedMessage[] } {
  const [next, ...rest] = queue;
  return { next: next ?? null, rest };
}

export function removeQueuedMessage(queue: readonly QueuedMessage[], id: string): readonly QueuedMessage[] {
  return queue.filter((message) => message.id !== id);
}

// Devuelve mensajes al input, en orden y DELANTE de lo que ya hubiera escrito (lo encolado es anterior).
// Cada `[Imagen N]` se desplaza por las imagenes que van delante, para que siga apuntando a la suya.
// ponytail: no se re-valida el tope de imagenes del conjunto; si se pasa, el envio lo rechaza en main.
export function mergeIntoDraft(messages: readonly QueuedMessage[], draft: PromptDraft): PromptDraft {
  if (messages.length === 0) return draft;
  const texts: string[] = [];
  const attachments: PromptDraft['attachments'][number][] = [];
  for (const message of messages) {
    pushText(texts, shiftImageTokens(message.text, attachments.length));
    for (const attachment of message.attachments) attachments.push({ attachment, byteLength: base64ByteLength(attachment.data) });
  }
  pushText(texts, shiftImageTokens(draft.text, attachments.length));
  return { text: texts.join(JOIN), attachments: [...attachments, ...draft.attachments] };
}

function pushText(texts: string[], text: string): void {
  if (text.trim().length > 0) texts.push(text.trim());
}
