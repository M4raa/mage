import { describe, expect, it } from 'vitest';
import { UserFacingError } from './i18n/localizedText';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  validateAttachment,
  validateAttachmentSet,
  type ImageAttachmentMeta,
} from './attachments';

const ES = 'es-ES';

const png = (byteLength: number): ImageAttachmentMeta => ({ mediaType: 'image/png', byteLength });

function catchError(action: () => unknown): unknown {
  try {
    action();
  } catch (err) {
    return err;
  }
  throw new Error('la acción no lanzó');
}

describe('validateAttachment', () => {
  it('validateAttachment_png_loAcepta', () => {
    expect(validateAttachment({ mediaType: 'image/png', byteLength: 1024 }, ES)).toEqual({ mediaType: 'image/png', byteLength: 1024 });
  });

  it('validateAttachment_mayusculasYEspacios_seNormaliza', () => {
    expect(validateAttachment({ mediaType: ' IMAGE/PNG ', byteLength: 10 }, ES).mediaType).toBe('image/png');
  });

  it('validateAttachment_svg_lanzaConElTipoRecibido', () => {
    expect(() => validateAttachment({ mediaType: 'image/svg+xml', byteLength: 10 }, ES)).toThrow(/no admitido.*image\/svg\+xml/i);
  });

  it('validateAttachment_tipoVacio_lanza', () => {
    expect(() => validateAttachment({ mediaType: '', byteLength: 10 }, ES)).toThrow(/no admitido/i);
  });

  it('validateAttachment_masDe5MiB_lanzaConElTamanoRecibido', () => {
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: MAX_ATTACHMENT_BYTES + 1 }, ES)).toThrow(/5,0 MiB/);
  });

  it('validateAttachment_exactamente5MiB_loAcepta', () => {
    expect(validateAttachment({ mediaType: 'image/png', byteLength: MAX_ATTACHMENT_BYTES }, ES).byteLength).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('validateAttachment_masDe5MiB_enUS_cifraConPunto', () => {
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: MAX_ATTACHMENT_BYTES + 1 }, 'en-US')).toThrow(/5\.0 MiB/);
  });

  it('validateAttachment_masDe5MiB_lanzaUserFacingErrorConClaveYValores', () => {
    const thrown = catchError(() => validateAttachment({ mediaType: 'image/png', byteLength: MAX_ATTACHMENT_BYTES + 1 }, ES));

    expect(thrown).toBeInstanceOf(UserFacingError);
    expect((thrown as UserFacingError).localized).toEqual({ key: 'errors.attachments.imageTooLarge', values: { size: '5,0 MiB', max: '5,0 MiB' } });
  });

  it('validateAttachmentSet_undecimoAdjunto_lanzaConClaveYCifrasComoTexto', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, () => png(10));
    const thrown = catchError(() => validateAttachmentSet(existing, [{ mediaType: 'image/png', byteLength: 10 }], ES));

    expect((thrown as UserFacingError).localized).toEqual({ key: 'errors.attachments.tooMany', values: { max: '10', count: '11' } });
  });

  it('validateAttachment_ceroBytes_lanza', () => {
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: 0 }, ES)).toThrow(/tamaño de imagen inválido: 0/i);
    expect(() => validateAttachment({ mediaType: 'image/png', byteLength: -5 }, ES)).toThrow(/inválido: -5/i);
  });
});

describe('validateAttachmentSet', () => {
  it('validateAttachmentSet_conjuntoVacio_devuelveVacio', () => {
    expect(validateAttachmentSet([], [], ES)).toEqual([]);
  });

  it('validateAttachmentSet_devuelveElConjuntoResultante', () => {
    const result = validateAttachmentSet([png(10)], [{ mediaType: 'image/webp', byteLength: 20 }], ES);

    expect(result).toEqual([png(10), { mediaType: 'image/webp', byteLength: 20 }]);
  });

  it('validateAttachmentSet_undecimoAdjunto_lanza', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, () => png(10));

    expect(() => validateAttachmentSet(existing, [{ mediaType: 'image/png', byteLength: 10 }], ES)).toThrow(/no más de 10|no se pueden adjuntar más de 10/i);
  });

  it('validateAttachmentSet_sumaSuperaElTotal_lanza', () => {
    const existing = [png(MAX_ATTACHMENT_BYTES), png(MAX_ATTACHMENT_BYTES), png(MAX_ATTACHMENT_BYTES)];

    expect(() => validateAttachmentSet(existing, [{ mediaType: 'image/png', byteLength: 1024 }], ES)).toThrow(/máximo por mensaje/i);
  });

  it('validateAttachmentSet_unoInvalidoEnElLote_lanzaYNoAdjuntaNinguno', () => {
    // Se valida ANTES de devolver nada: no se cuela media tanda.
    expect(() =>
      validateAttachmentSet([], [{ mediaType: 'image/png', byteLength: 10 }, { mediaType: 'application/pdf', byteLength: 10 }], ES),
    ).toThrow(/no admitido/i);
  });
});
