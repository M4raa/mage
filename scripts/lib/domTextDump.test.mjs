import { describe, expect, it } from 'vitest';
import { diffDumps, normalizeDomLine } from './domTextDump.mjs';

const dump = (entries) => new Map(entries.map((e) => [e.name, { attrs: [], ...e }]));

describe('normalizeDomLine', () => {
  it('normalizeDomLine_relojesIdsYEspacios_noCuentanComoTexto', () => {
    expect(normalizeDomLine('Hace 12 s · 3,5 KB  ·  a1b2c3d4-0000-4000-8000-000000000000')).toBe('Hace 0 s · 0 KB · <uuid>');
    expect(normalizeDomLine('commit 04d572fa1b')).toBe('commit <hex>');
  });
});

describe('diffDumps', () => {
  it('diffDumps_mismoTextoConOtroReloj_sinDiferencias', () => {
    const before = dump([{ name: 'A', text: 'IDIOMA\nHace 3 s', attrs: ['aria-label=Cerrar'] }]);
    const after = dump([{ name: 'A', text: 'IDIOMA\nHace 9 s', attrs: ['aria-label=Cerrar'] }]);

    expect(diffDumps(before, after)).toEqual([]);
  });

  it('diffDumps_textoCambiado_diceLaLineaDeCadaLado', () => {
    const before = dump([{ name: 'A', text: 'Idioma', attrs: ['title=Abrir'] }]);
    const after = dump([{ name: 'A', text: 'Language', attrs: ['title=Abrir'] }]);

    expect(diffDumps(before, after)).toEqual([{ name: 'A', onlyBefore: ['Idioma'], onlyAfter: ['Language'] }]);
  });

  it('diffDumps_lineaRepetidaUnaVezMenos_esDiferencia', () => {
    const before = dump([{ name: 'A', text: 'x\nx' }]);
    const after = dump([{ name: 'A', text: 'x' }]);

    expect(diffDumps(before, after)).toEqual([{ name: 'A', onlyBefore: ['x'], onlyAfter: [] }]);
  });

  it('diffDumps_comprobacionQueFaltaEnUnLado_seDice', () => {
    expect(diffDumps(dump([{ name: 'A', text: '' }]), dump([{ name: 'B', text: '' }]))).toEqual([
      { name: 'A', missing: 'after' },
      { name: 'B', missing: 'before' },
    ]);
  });
});
