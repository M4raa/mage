import { describe, expect, it } from 'vitest';
import { enterAction } from './promptEnter';
import type { TextState } from './promptEditing';

// El cursor va marcado con `|` en el texto del caso, que es mas legible que contar offsets a mano.
function state(withCursor: string): TextState {
  const offset = withCursor.indexOf('|');
  const value = withCursor.replace('|', '');
  return { value, selectionStart: offset, selectionEnd: offset };
}

describe('enterAction', () => {
  it('enterAction_itemDeListaConContenido_continuaLaLista', () => {
    expect(enterAction(state('- uno|'))).toBe('continue-list');
  });

  it('enterAction_itemDeListaVacio_envia', () => {
    // Un item vacio significa "he terminado la lista": Enter envia (y el marcador se borra antes).
    expect(enterAction(state('- uno\n- |'))).toBe('send');
  });

  it('enterAction_itemOrdenadoConContenido_continua', () => {
    expect(enterAction(state('1. uno|'))).toBe('continue-list');
    expect(enterAction(state('2) dos|'))).toBe('continue-list');
  });

  it('enterAction_itemOrdenadoVacio_envia', () => {
    expect(enterAction(state('1. uno\n2. |'))).toBe('send');
  });

  it('enterAction_lineaNormal_envia', () => {
    expect(enterAction(state('hola que tal|'))).toBe('send');
  });

  it('enterAction_textoVacio_envia', () => {
    expect(enterAction(state('|'))).toBe('send');
  });

  it('enterAction_cursorEnMedioDeUnItem_continuaLaLista', () => {
    expect(enterAction(state('- un|o'))).toBe('continue-list');
  });

  it('enterAction_seleccionQueAbarcaVariasLineas_envia', () => {
    // Con seleccion no se esta "escribiendo en una linea": enviar es lo que hacia el textarea.
    expect(enterAction({ value: '- uno\n- dos', selectionStart: 0, selectionEnd: 11 })).toBe('send');
  });

  it('enterAction_lineaDeListaAnidada_continua', () => {
    expect(enterAction(state('- uno\n  - anidado|'))).toBe('continue-list');
  });

  it('enterAction_dentroDeUnaVallaDeCodigo_NO_envia', () => {
    // EL caso que sin test manda un turno a medias: una lista dentro de ``` no es una lista.
    expect(enterAction(state('```\n- uno|'))).toBe('newline');
    expect(enterAction(state('```ts\nconst a = 1;|'))).toBe('newline');
  });

  it('enterAction_trasCerrarLaValla_vuelveAEnviar', () => {
    expect(enterAction(state('```\ncodigo\n```\nhola|'))).toBe('send');
  });

  it('enterAction_lineaDeListaSinEspacioTrasElMarcador_noEsLista', () => {
    // `-uno` no es un item de lista (ni para el CLI ni para el parser del chat).
    expect(enterAction(state('-uno|'))).toBe('send');
  });
});
