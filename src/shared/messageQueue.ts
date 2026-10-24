import type { QueuedMessage } from './coordination';

// Cola de mensajes de Mage (0.1.1 R2, punto 30): con un turno en marcha el mensaje espera y sale como turno
// propio cuando el turno acaba, uno por turno y en orden. Desde F2.2 la decide main (la coordinacion de
// sesiones); aqui solo esta la forma de la cola, PURA.

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

