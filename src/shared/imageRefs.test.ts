import { describe, expect, it } from 'vitest';
import type { ImageAttachment } from './ipc';
import { buildUserContentBlocks, imageToken, insertImageTokens, removeImageToken } from './imageRefs';

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
