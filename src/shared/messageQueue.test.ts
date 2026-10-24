import { describe, expect, it } from 'vitest';
import type { ImageAttachment } from './ipc';
import type { QueuedMessage } from './coordination';
import { enqueueMessage, removeQueuedMessage, takeNextMessage } from './messageQueue';

const img = (data: string): ImageAttachment => ({ mediaType: 'image/png', data });
const msg = (id: string, text: string, attachments: readonly ImageAttachment[] = []): QueuedMessage => ({ id, text, attachments });

describe('enqueueMessage / takeNextMessage', () => {
  it('enqueue_variosMensajes_salenEnOrdenDeUnoEnUno', () => {
    const queue = enqueueMessage(enqueueMessage([], msg('a', 'uno')), msg('b', 'dos'));

    const first = takeNextMessage(queue);
    const second = takeNextMessage(first.rest);

    expect(first.next?.text).toBe('uno');
    expect(second.next?.text).toBe('dos');
    expect(second.rest).toEqual([]);
  });

  it('takeNextMessage_colaVacia_devuelveNull', () => {
    expect(takeNextMessage([])).toEqual({ next: null, rest: [] });
  });

  it('enqueue_conAdjuntos_losConserva', () => {
    const queue = enqueueMessage([], msg('a', '[Imagen 1]', [img('AAAA')]));

    expect(takeNextMessage(queue).next?.attachments).toEqual([img('AAAA')]);
  });

  it('enqueue_sinId_lanza', () => {
    expect(() => enqueueMessage([], msg('', 'hola'))).toThrow(/hola/);
  });
});

describe('removeQueuedMessage', () => {
  it('remove_porId_quitaSoloEse', () => {
    const queue = [msg('a', 'uno'), msg('b', 'dos'), msg('c', 'tres')];

    expect(removeQueuedMessage(queue, 'b').map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('remove_idQueNoEsta_dejaLaCola', () => {
    const queue = [msg('a', 'uno')];

    expect(removeQueuedMessage(queue, 'zz')).toEqual(queue);
  });
});
