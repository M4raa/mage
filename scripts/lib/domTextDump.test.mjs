import { describe, expect, it } from 'vitest';
import { diffAttrs, diffDumps, diffJoined, joinedTextOf, normalizeDomLine, partitionNoise, readIgnoreList } from './domTextDump.mjs';

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

describe('joinedTextOf', () => {
  it('joinedTextOf_textoRepartidoEnOtrosNodos_esIgual', () => {
    const split = { name: 'A', text: 'La cuenta\ntiene\n2\nMCP que no están en los comunes', attrs: ['title=x'] };
    const whole = { name: 'A', text: 'La cuenta tiene 2 MCP que no están en los comunes', attrs: [] };

    expect(joinedTextOf(split)).toBe(joinedTextOf(whole));
  });

  it('joinedTextOf_numeroDistinto_esDistinto', () => {
    expect(joinedTextOf({ name: 'A', text: '3 pasos', attrs: [] })).not.toBe(joinedTextOf({ name: 'A', text: '3 pasas', attrs: [] }));
  });
});

describe('diffJoined', () => {
  it('diffJoined_casoAusente_loMarca', () => {
    expect(diffJoined(dump([{ name: 'A', text: 'x' }]), dump([{ name: 'B', text: 'x' }]))).toEqual([
      { name: 'A', missing: 'after' },
      { name: 'B', missing: 'before' },
    ]);
  });

  it('diffJoined_textoDistinto_daFragmentosDeCadaLado', () => {
    const before = dump([{ name: 'A', text: 'Permitido siempre (\n3' }]);
    const after = dump([{ name: 'A', text: 'Permitido siempre (3)' }]);

    expect(diffJoined(before, after)).toEqual([{ name: 'A', before: 'Permitidosiempre(0', after: 'Permitidosiempre(0)' }]);
  });
});

describe('diffAttrs', () => {
  it('diffAttrs_soloAtributos_ignoraElTexto', () => {
    const before = dump([{ name: 'A', text: 'Idioma', attrs: ['title=Abrir'] }]);
    const after = dump([{ name: 'A', text: 'Language', attrs: ['title=Abrir'] }]);

    expect(diffAttrs(before, after)).toEqual([]);
  });

  it('diffAttrs_atributoCambiado_loDice', () => {
    const before = dump([{ name: 'A', text: 'x', attrs: ['title=Abrir'] }]);
    const after = dump([{ name: 'A', text: 'x', attrs: ['title=Open'] }]);

    expect(diffAttrs(before, after)).toEqual([{ name: 'A', onlyBefore: ['title=Abrir'], onlyAfter: ['title=Open'] }]);
  });
});

describe('partitionNoise', () => {
  it('partitionNoise_casoDistintoTambienEntreTandas_quedaDescartadoComoRuido', () => {
    const base = dump([{ name: 'ruidoso', text: 'a' }, { name: 'estable', text: 'b' }]);
    const ref2 = dump([{ name: 'ruidoso', text: 'a-otra-tanda' }, { name: 'estable', text: 'b' }]);
    const after = dump([{ name: 'ruidoso', text: 'a-cambiado' }, { name: 'estable', text: 'b-cambiado' }]);
    const noiseNames = diffJoined(base, ref2).map((d) => d.name);

    const { kept, noise } = partitionNoise(diffJoined(base, after), noiseNames);

    expect(noise.map((d) => d.name)).toEqual(['ruidoso']);
    expect(kept.map((d) => d.name)).toEqual(['estable']);
  });
});

describe('readIgnoreList', () => {
  it('readIgnoreList_sinReason_lanza', () => {
    expect(() => readIgnoreList([{ name: 'A' }])).toThrow('sin reason: A');
    expect(() => readIgnoreList([{ name: 'A', reason: '  ' }])).toThrow('sin reason: A');
  });

  it('readIgnoreList_listaValida_laDevuelve', () => {
    const list = [{ name: 'A', reason: 'tooltip según el ratón' }];

    expect(readIgnoreList(list)).toBe(list);
  });
});
