import { describe, expect, it } from 'vitest';
import type { ImageAttachment } from '@shared/ipc';
import { enqueueMessage, mergeIntoDraft, removeQueuedMessage, takeNextMessage, type QueuedMessage } from './messageQueue';

const img = (data: string): ImageAttachment => ({ mediaType: 'image/png', data });
const msg = (id: string, text: string, attachments: readonly ImageAttachment[] = []): QueuedMessage => ({ id, text, attachments });
const EMPTY_DRAFT = { text: '', attachments: [] };

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

describe('mergeIntoDraft (Stop y editar devuelven al input)', () => {
  it('merge_variosMensajes_seConcatenanEnOrdenDelanteDelBorrador', () => {
    const draft = mergeIntoDraft([msg('a', 'uno'), msg('b', 'dos')], { text: 'tres', attachments: [] });

    expect(draft.text).toBe('uno\n\ndos\n\ntres');
  });

  it('merge_conImagenes_renumeraLosTokensYJuntaLosAdjuntos', () => {
    const draft = mergeIntoDraft(
      [msg('a', 'mira [Imagen 1]', [img('AAAA')]), msg('b', '[Imagen 1] y [Imagen 2]', [img('BBBB'), img('CCCC')])],
      { text: 'y [Imagen 1]', attachments: [{ attachment: img('DDDD'), byteLength: 3 }] },
    );

    expect(draft.text).toBe('mira [Imagen 1]\n\n[Imagen 2] y [Imagen 3]\n\ny [Imagen 4]');
    expect(draft.attachments.map((a) => a.attachment.data)).toEqual(['AAAA', 'BBBB', 'CCCC', 'DDDD']);
    expect(draft.attachments[0]?.byteLength).toBe(3);
  });

  it('merge_mensajeSoloImagenYBorradorVacio_noDejaSeparadoresSueltos', () => {
    const draft = mergeIntoDraft([msg('a', '', [img('AAAA')])], EMPTY_DRAFT);

    expect(draft.text).toBe('');
    expect(draft.attachments).toHaveLength(1);
  });

  it('merge_sinMensajes_devuelveElMismoBorrador', () => {
    const current = { text: 'hola', attachments: [] };

    expect(mergeIntoDraft([], current)).toBe(current);
  });
});
