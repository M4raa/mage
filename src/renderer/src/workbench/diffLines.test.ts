import { describe, expect, it } from 'vitest';
import { parseStructuredPatch } from './diffLines';

// Hunk LITERAL medido en una transcripcion real (PLAN-MEJORA §0.2, M2): los 141 hunks de ese fichero
// traen oldStart/oldLines/newStart/newLines.
const REAL_HUNK = {
  oldStart: 13,
  oldLines: 7,
  newStart: 13,
  newLines: 6,
  lines: [' import type { Foo } from "./foo";', '-const a = 1;', '+const a = 2;', ' export default a;'],
};

describe('parseStructuredPatch', () => {
  it('parseStructuredPatch_hunkReal_numeraAmbosLados', () => {
    expect(parseStructuredPatch([REAL_HUNK])).toEqual([
      { sign: ' ', text: 'import type { Foo } from "./foo";', oldLine: 13, newLine: 13 },
      { sign: '-', text: 'const a = 1;', oldLine: 14, newLine: null },
      { sign: '+', text: 'const a = 2;', oldLine: null, newLine: 14 },
      { sign: ' ', text: 'export default a;', oldLine: 15, newLine: 15 },
    ]);
  });

  it('parseStructuredPatch_adicion_oldLineEsNull', () => {
    const lines = parseStructuredPatch([{ oldStart: 5, newStart: 5, lines: ['+nueva'] }]);

    expect(lines?.[0]).toEqual({ sign: '+', text: 'nueva', oldLine: null, newLine: 5 });
  });

  it('parseStructuredPatch_borrado_newLineEsNull', () => {
    const lines = parseStructuredPatch([{ oldStart: 5, newStart: 5, lines: ['-vieja'] }]);

    expect(lines?.[0]).toEqual({ sign: '-', text: 'vieja', oldLine: 5, newLine: null });
  });

  it('parseStructuredPatch_variosHunks_insertaSeparadorYSaltaLaNumeracion', () => {
    const lines = parseStructuredPatch([
      { oldStart: 1, newStart: 1, lines: [' a'] },
      { oldStart: 40, newStart: 41, lines: [' b'] },
    ]);

    expect(lines).toEqual([
      { sign: ' ', text: 'a', oldLine: 1, newLine: 1 },
      { sign: ' ', text: '⋯', oldLine: null, newLine: null },
      { sign: ' ', text: 'b', oldLine: 40, newLine: 41 },
    ]);
  });

  it('parseStructuredPatch_structuredPatchVacio_devuelveNull', () => {
    // MEDIDO: 15 de los 156 `structuredPatch` de una transcripcion real no traen hunks (un `Write` que
    // crea fichero). Devolver [] haria pintar un visor de diff vacio.
    expect(parseStructuredPatch([])).toBeNull();
    expect(parseStructuredPatch([{ lines: [] }])).toBeNull();
  });

  it('parseStructuredPatch_hunkSinOldStart_devuelveLineasSinNumeros', () => {
    // No numerar antes que numerar mal: sin `oldStart` no se sabe por donde va el hunk.
    expect(parseStructuredPatch([{ lines: ['+a'] }])).toEqual([{ sign: '+', text: 'a', oldLine: null, newLine: null }]);
  });

  it('parseStructuredPatch_oldStartNoNumerico_devuelveLineasSinNumeros', () => {
    const lines = parseStructuredPatch([{ oldStart: 'trece', newStart: 0, lines: [' a'] }]);

    expect(lines).toEqual([{ sign: ' ', text: 'a', oldLine: null, newLine: null }]);
  });

  it('parseStructuredPatch_noArray_devuelveNull', () => {
    expect(parseStructuredPatch(undefined)).toBeNull();
    expect(parseStructuredPatch(null)).toBeNull();
    expect(parseStructuredPatch('nope')).toBeNull();
  });

  it('parseStructuredPatch_lineaNoNewlineAlFinal_vaComoContexto', () => {
    const lines = parseStructuredPatch([{ oldStart: 1, newStart: 1, lines: ['\\ No newline at end of file'] }]);

    expect(lines?.[0]?.sign).toBe(' ');
  });

  it('parseStructuredPatch_lineaNoString_seSalta', () => {
    const lines = parseStructuredPatch([{ oldStart: 1, newStart: 1, lines: [' a', 42, '+b'] }]);

    expect(lines).toHaveLength(2);
  });
});
