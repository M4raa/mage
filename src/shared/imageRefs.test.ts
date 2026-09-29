import { describe, expect, it } from 'vitest';
import type { ImageAttachment } from './ipc';
import {
  shiftImageTokens,
  buildUserContentBlocks,
  describeAttachment,
  findImageTokens,
  imageToken,
  insertImageTokens,
  reconcileImageTokens,
  removeImageToken,
} from './imageRefs';

const img = (data: string): ImageAttachment => ({ mediaType: 'image/png', data });
const at = (value: string, caret = value.length) => ({ value, selectionStart: caret, selectionEnd: caret });

describe('imageToken', () => {
  it('imageToken_baseUno', () => {
    expect(imageToken(1)).toBe('[Imagen 1]');
  });

  it('imageToken_ceroONoEntero_lanzaConElValor', () => {
    expect(() => imageToken(0)).toThrow(/0/);
    expect(() => imageToken(1.5)).toThrow(/1\.5/);
  });
});

describe('insertImageTokens', () => {
  it('insertImageTokens_enElCursor_separaConEspacios', () => {
    const result = insertImageTokens(at('mira esto', 4), 1, 1);

    expect(result.value).toBe('mira [Imagen 1] esto');
    expect(result.selectionStart).toBe('mira [Imagen 1]'.length);
  });

  it('insertImageTokens_varios_seguidosYNumeradosDesdeFromN', () => {
    expect(insertImageTokens(at('a '), 3, 2).value).toBe('a [Imagen 3] [Imagen 4]');
  });

  it('insertImageTokens_textoVacio_soloLosTokens', () => {
    expect(insertImageTokens(at(''), 1, 2).value).toBe('[Imagen 1] [Imagen 2]');
  });

  it('insertImageTokens_conSeleccion_laSustituye', () => {
    expect(insertImageTokens({ value: 'ver ESTO ya', selectionStart: 4, selectionEnd: 8 }, 1, 1).value).toBe('ver [Imagen 1] ya');
  });

  it('insertImageTokens_cero_noToca', () => {
    const state = at('igual');
    expect(insertImageTokens(state, 1, 0)).toBe(state);
  });
});

describe('removeImageToken', () => {
  it('removeImageToken_elDelMedio_renumeraLosDeDetras', () => {
    expect(removeImageToken('a [Imagen 1] b [Imagen 2] c [Imagen 3]', 2)).toBe('a [Imagen 1] b c [Imagen 2]');
  });

  it('removeImageToken_elPrimero_elSegundoPasaASer1', () => {
    expect(removeImageToken('[Imagen 1] [Imagen 2]', 1)).toBe('[Imagen 1]');
  });

  it('removeImageToken_sinEseToken_soloRenumera', () => {
    expect(removeImageToken('x [Imagen 3]', 2)).toBe('x [Imagen 2]');
  });
});

describe('buildUserContentBlocks', () => {
  it('buildUserContentBlocks_intercalado_cadaImagenDetrasDeSuToken', () => {
    const blocks = buildUserContentBlocks('mira [Imagen 1] y compara con [Imagen 2]', [img('A'), img('B')]);

    expect(blocks.map((b) => (b.type === 'text' ? `t:${b.text}` : `i:${b.source.data}`))).toEqual([
      't:mira [Imagen 1]',
      'i:A',
      't: y compara con [Imagen 2]',
      'i:B',
    ]);
  });

  it('buildUserContentBlocks_juntarLosTextos_devuelveElOriginal', () => {
    const text = '¿qué pasa en [Imagen 2] frente a [Imagen 1]?';
    const blocks = buildUserContentBlocks(text, [img('A'), img('B')]);

    expect(blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('')).toBe(text);
  });

  it('buildUserContentBlocks_imagenHuerfana_alFinalConSuEtiqueta', () => {
    const blocks = buildUserContentBlocks('solo [Imagen 2]', [img('A'), img('B')]);

    expect(blocks.map((b) => (b.type === 'text' ? `t:${b.text}` : `i:${b.source.data}`))).toEqual(['t:solo [Imagen 2]', 'i:B', 't: [Imagen 1]', 'i:A']);
  });

  it('buildUserContentBlocks_tokenSinImagen_quedaComoTexto', () => {
    expect(buildUserContentBlocks('ver [Imagen 5]', [img('A')])).toEqual([
      { type: 'text', text: 'ver [Imagen 5]' },
      { type: 'text', text: ' [Imagen 1]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A' } },
    ]);
  });

  it('buildUserContentBlocks_soloImagenesSinTexto_cadaUnaConSuEtiqueta', () => {
    const blocks = buildUserContentBlocks('', [img('A'), img('B')]);

    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text', 'image']);
  });

  it('buildUserContentBlocks_tokenRepetido_laImagenSoloUnaVez', () => {
    const blocks = buildUserContentBlocks('[Imagen 1] y otra vez [Imagen 1]', [img('A')]);

    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(1);
  });

  it('buildUserContentBlocks_nuncaTextoVacio', () => {
    const blocks = buildUserContentBlocks('[Imagen 1]', [img('A')]);

    expect(blocks.every((b) => b.type !== 'text' || b.text.length > 0)).toBe(true);
  });
});

describe('findImageTokens', () => {
  it('findImageTokens_variosYDuplicados_devuelveCadaUnoConSuPosicion', () => {
    expect(findImageTokens('a [Imagen 1] b [Imagen 2] [Imagen 1]')).toEqual([
      { from: 2, to: 12, n: 1 },
      { from: 15, to: 25, n: 2 },
      { from: 26, to: 36, n: 1 },
    ]);
  });

  it('findImageTokens_sinTokensOVacio_devuelveVacio', () => {
    expect(findImageTokens('')).toEqual([]);
    expect(findImageTokens('[Imagen]')).toEqual([]);
  });
});

describe('reconcileImageTokens', () => {
  const three = ['A', 'B', 'C'];

  it('reconcileImageTokens_borrarUnoDeTres_quitaSuAdjuntoYRenumera', () => {
    const result = reconcileImageTokens('[Imagen 1] [Imagen 2] [Imagen 3]', '[Imagen 1]  [Imagen 3]', three);

    expect(result.attachments).toEqual(['A', 'C']);
    expect(result.text).toBe('[Imagen 1]  [Imagen 2]');
  });

  it('reconcileImageTokens_borrarElUltimo_quitaSoloElUltimo', () => {
    const result = reconcileImageTokens('[Imagen 1] [Imagen 2]', '[Imagen 1] ', ['A', 'B']);

    expect(result.attachments).toEqual(['A']);
    expect(result.text).toBe('[Imagen 1] ');
  });

  it('reconcileImageTokens_borrarVarios_renumeraSinDescuadrarse', () => {
    const result = reconcileImageTokens('[Imagen 1] [Imagen 2] [Imagen 3]', '[Imagen 2]', three);

    expect(result.attachments).toEqual(['B']);
    expect(result.text).toBe('[Imagen 1]');
  });

  it('reconcileImageTokens_tokenDuplicadoBorraUnaCopia_conservaElAdjunto', () => {
    const result = reconcileImageTokens('[Imagen 1] [Imagen 1]', '[Imagen 1]', ['A']);

    expect(result.attachments).toEqual(['A']);
    expect(result.text).toBe('[Imagen 1]');
  });

  it('reconcileImageTokens_sinAdjuntos_dejaElTextoIgual', () => {
    const result = reconcileImageTokens('[Imagen 1] hola', 'hola', []);

    expect(result).toEqual({ text: 'hola', attachments: [] });
  });

  it('reconcileImageTokens_sinCambiosEnLosTokens_noTocaNada', () => {
    const result = reconcileImageTokens('a [Imagen 1]', 'ab [Imagen 1]', ['A']);

    expect(result).toEqual({ text: 'ab [Imagen 1]', attachments: ['A'] });
  });

  it('reconcileImageTokens_tokenSinAdjuntoTodavia_noSeTrata', () => {
    // La imagen 2 aun se esta leyendo: su token puede desaparecer sin que haya nada que quitar.
    const result = reconcileImageTokens('[Imagen 1] [Imagen 2]', '[Imagen 1]', ['A']);

    expect(result.attachments).toEqual(['A']);
  });

  it('reconcileImageTokens_tokenYaAusenteAntes_noQuitaAdjunto', () => {
    // El token se cortó antes (el adjunto viaja al final): borrar otra cosa no lo toca.
    const result = reconcileImageTokens('hola', 'hol', ['A']);

    expect(result).toEqual({ text: 'hol', attachments: ['A'] });
  });
});

describe('describeAttachment', () => {
  it('describeAttachment_pngDe245KiB_devuelveNTipoYTamano', () => {
    expect(describeAttachment(2, 'image/png', 245 * 1024)).toBe('Imagen 2 · png · 245 KiB');
  });

  it('describeAttachment_tipoInvalido_lanzaConElValor', () => {
    expect(() => describeAttachment(1, 'png', 10)).toThrow(/png/);
  });
});

describe('shiftImageTokens', () => {
  it('shiftImageTokens_conDesplazamiento_sumaACadaToken', () => {
    expect(shiftImageTokens('mira [Imagen 1] y [Imagen 2]', 3)).toBe('mira [Imagen 4] y [Imagen 5]');
  });

  it('shiftImageTokens_ceroOSinTokens_devuelveElMismoTexto', () => {
    expect(shiftImageTokens('[Imagen 1]', 0)).toBe('[Imagen 1]');
    expect(shiftImageTokens('', 2)).toBe('');
  });

  it('shiftImageTokens_negativoOFraccion_lanza', () => {
    expect(() => shiftImageTokens('x', -1)).toThrow(/-1/);
    expect(() => shiftImageTokens('x', 1.5)).toThrow(/1.5/);
  });
});
