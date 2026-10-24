import type { ImageAttachment } from '@shared/ipc';
import { base64ByteLength } from '@shared/attachments';
import { shiftImageTokens } from '@shared/imageRefs';
import type { PromptDraft } from './types';
import type { QueuedMessage } from '@shared/coordination';

export type { QueuedMessage };

// Cola de mensajes de Mage (0.1.1 R2, punto 30). Desde F2.2 su dueño es main (src/shared/messageQueue.ts y
// la coordinacion de sesiones): el renderer solo la PINTA y devuelve sus mensajes al input (Stop o editar).

// Separador entre mensajes al devolverlos al input: el mismo parrafo en blanco que usa el resto del prompt.
const JOIN = '\n\n';

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
