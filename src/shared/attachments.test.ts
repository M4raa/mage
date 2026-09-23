import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  validateAttachment,
  validateAttachmentSet,
  type ImageAttachmentMeta,
} from './attachments';

const png = (byteLength: number): ImageAttachmentMeta => ({ mediaType: 'image/png', byteLength });

describe('validateAttachment', () => {
  it('validateAttachment_png_loAcepta', () => {
    expect(validateAttachment({ mediaType: 'image/png', byteLength: 1024 })).toEqual({ mediaType: 'image/png', byteLength: 1024 });
  });

  it('validateAttachment_mayusculasYEspacios_seNormaliza', () => {
    expect(validateAttachment({ mediaType: ' IMAGE/PNG ', byteLength: 10 }).mediaType).toBe('image/png');
  });

  it('validateAttachment_svg_lanzaConElTipoRecibido', () => {
    expect(() => validateAttachment({ mediaType: 'image/svg+xml', byteLength: 10 })).toThrow(/no admitido.*image\/svg\+xml/i);
  });

  it('validateAttachment_tipoVacio_lanza', () => {
    expect(() => validateAttachment({ mediaType: '', byteLength: 10 })).toThrow(/no admitido/i);
  });

  it('validateAttachment_masDe5MiB_lanzaConElTamanoRecibido', () => {
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: MAX_ATTACHMENT_BYTES + 1 })).toThrow(/5\.0 MiB/);
  });

  it('validateAttachment_exactamente5MiB_loAcepta', () => {
    expect(validateAttachment({ mediaType: 'image/png', byteLength: MAX_ATTACHMENT_BYTES }).byteLength).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('validateAttachment_ceroBytes_lanza', () => {
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: 0 })).toThrow(/tamaño de imagen invalido: 0/i);
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: -5 })).toThrow(/invalido: -5/i);
  });
});

describe('validateAttachmentSet', () => {
  it('validateAttachmentSet_conjuntoVacio_devuelveVacio', () => {
    expect(validateAttachmentSet([], [])).toEqual([]);
  });

  it('validateAttachmentSet_devuelveElConjuntoResultante', () => {
    const result = validateAttachmentSet([png(10)], [{ mediaType: 'image/webp', byteLength: 20 }]);

    expect(result).toEqual([png(10), { mediaType: 'image/webp', byteLength: 20 }]);
  });

  it('validateAttachmentSet_undecimoAdjunto_lanza', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, () => png(10));

    expect(() => validateAttachmentSet(existing, [{ mediaType: 'image/png', byteLength: 10 }])).toThrow(/no mas de 10|no se pueden adjuntar mas de 10/i);
  });

  it('validateAttachmentSet_sumaSuperaElTotal_lanza', () => {
    const existing = [png(MAX_ATTACHMENT_BYTES), png(MAX_ATTACHMENT_BYTES), png(MAX_ATTACHMENT_BYTES)];

    expect(() => validateAttachmentSet(existing, [{ mediaType: 'image/png', byteLength: 1024 }])).toThrow(/maximo por mensaje/i);
  });

  it('validateAttachmentSet_unoInvalidoEnElLote_lanzaYNoAdjuntaNinguno', () => {
    // Se valida ANTES de devolver nada: no se cuela media tanda.
    expect(() =>
      validateAttachmentSet([], [{ mediaType: 'image/png', byteLength: 10 }, { mediaType: 'application/pdf', byteLength: 10 }]),
    ).toThrow(/no admitido/i);
  });
});
