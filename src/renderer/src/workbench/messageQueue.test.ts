import { describe, expect, it } from 'vitest';
import type { ImageAttachment } from '@shared/ipc';
import { mergeIntoDraft, type QueuedMessage } from './messageQueue';

const img = (data: string): ImageAttachment => ({ mediaType: 'image/png', data });
const msg = (id: string, text: string, attachments: readonly ImageAttachment[] = []): QueuedMessage => ({ id, text, attachments });
const EMPTY_DRAFT = { text: '', attachments: [] };

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
