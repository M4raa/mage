import { describe, expect, it } from 'vitest';
import { continueListOnNewline, indentLines, outdentLines, type TextState } from './promptEditing';

// Helper: construye un TextState marcando el cursor/seleccion con '|' (uno = colapsado, dos = rango).
function at(marked: string): TextState {
  const first = marked.indexOf('|');
  const rest = marked.slice(first + 1);
  const second = rest.indexOf('|');
  const value = marked.replace(/\|/g, '');
  if (second === -1) return { value, selectionStart: first, selectionEnd: first };
  return { value, selectionStart: first, selectionEnd: first + second };
}

describe('continueListOnNewline', () => {
  it('continueListOnNewline_itemDesordenadoConContenido_insertaMarcador', () => {
    const result = continueListOnNewline(at('- uno|'));

    expect(result?.value).toBe('- uno\n- ');
    expect(result?.selectionStart).toBe('- uno\n- '.length);
  });

  it('continueListOnNewline_bulletAsterisco_seConserva', () => {
    expect(continueListOnNewline(at('* uno|'))?.value).toBe('* uno\n* ');
  });

  it('continueListOnNewline_bulletMas_seConserva', () => {
    expect(continueListOnNewline(at('+ uno|'))?.value).toBe('+ uno\n+ ');
  });

  it('continueListOnNewline_itemOrdenadoPunto_incrementaOrdinal', () => {
    expect(continueListOnNewline(at('1. uno|'))?.value).toBe('1. uno\n2. ');
  });

  it('continueListOnNewline_itemOrdenadoParentesis_incrementaOrdinal', () => {
    expect(continueListOnNewline(at('3) x|'))?.value).toBe('3) x\n4) ');
  });

  it('continueListOnNewline_ordinalVariosDigitos_incrementa', () => {
    expect(continueListOnNewline(at('10. diez|'))?.value).toBe('10. diez\n11. ');
  });

  it('continueListOnNewline_indentacionAnidada_seConserva', () => {
    expect(continueListOnNewline(at('  - a|'))?.value).toBe('  - a\n  - ');
  });

  it('continueListOnNewline_itemVacioAlFinal_eliminaMarcador', () => {
    const result = continueListOnNewline(at('- |'));

    expect(result?.value).toBe('');
    expect(result?.selectionStart).toBe(0);
  });

  it('continueListOnNewline_itemVacioOrdenado_eliminaMarcador', () => {
    expect(continueListOnNewline(at('1. |'))?.value).toBe('');
  });

  it('continueListOnNewline_lineaNoLista_devuelveNull', () => {
    expect(continueListOnNewline(at('texto normal|'))).toBeNull();
  });

  it('continueListOnNewline_continuaSoloLaLineaDelCursor_noLaAnterior', () => {
    const result = continueListOnNewline(at('- uno\n- dos|'));

    expect(result?.value).toBe('- uno\n- dos\n- ');
  });

  it('continueListOnNewline_conSeleccion_reemplazaElRango', () => {
    // Selecciona "dos" y continua: se reemplaza la seleccion por el salto + marcador.
    const result = continueListOnNewline(at('- |dos|'));

    expect(result?.value).toBe('- \n- ');
  });
});

describe('indentLines', () => {
  it('indentLines_cursorColapsado_indentaLaLinea', () => {
    const result = indentLines(at('abc|'));

    expect(result.value).toBe('  abc');
    expect(result.selectionStart).toBe(5); // 3 + 2
    expect(result.selectionEnd).toBe(5);
  });

  it('indentLines_seleccionMultilinea_indentaTodasLasLineas', () => {
    const result = indentLines(at('|a\nb|'));

    expect(result.value).toBe('  a\n  b');
  });

  it('indentLines_seleccionMultilinea_ajustaElFinPorNumeroDeLineas', () => {
    const result = indentLines(at('|a\nb|'));

    // start +2, end +2*2 lineas
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe('a\nb'.length + 4);
  });
});

describe('outdentLines', () => {
  it('outdentLines_dosEspacios_losQuita', () => {
    const result = outdentLines(at('  abc|'));

    expect(result.value).toBe('abc');
  });

  it('outdentLines_unEspacio_quitaSoloUno', () => {
    expect(outdentLines(at(' abc|')).value).toBe('abc');
  });

  it('outdentLines_sinSangria_noHaceNada', () => {
    const state = at('abc|');
    const result = outdentLines(state);

    expect(result.value).toBe('abc');
    expect(result.selectionStart).toBe(state.selectionStart);
  });

  it('outdentLines_tab_quitaElTab', () => {
    expect(outdentLines(at('\tabc|')).value).toBe('abc');
  });

  it('outdentLines_multilinea_desindentaCadaLinea', () => {
    const result = outdentLines(at('|  a\n  b|'));

    expect(result.value).toBe('a\nb');
  });

  it('outdentLines_masDeDosEspacios_quitaSoloLaUnidad', () => {
    expect(outdentLines(at('    abc|')).value).toBe('  abc');
  });

  it('outdentLines_seleccionNoSeVuelveNegativa', () => {
    const result = outdentLines(at('|a|'));

    expect(result.selectionStart).toBeGreaterThanOrEqual(0);
    expect(result.selectionEnd).toBeGreaterThanOrEqual(result.selectionStart);
  });
});
