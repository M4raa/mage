import { describe, expect, it } from 'vitest';
import { decorationRangesFor, type DecorationRange } from './promptDecorations';

const kinds = (ranges: readonly DecorationRange[]): readonly string[] => ranges.map((r) => r.kind);

// Sin cursor en ninguna linea real: -1. Asi se prueba el caso "todas las lineas ocultan su marcador".
const NO_CURSOR = -1;

describe('decorationRangesFor — listas', () => {
  it('decorationRangesFor_bulletFueraDelCursor_devuelveBulletPintado', () => {
    // Fuera de la linea del cursor, el `- ` se oculta y un `::before` pinta la viñeta.
    const ranges = decorationRangesFor('- uno', NO_CURSOR);

    expect(kinds(ranges)).toContain('bullet-painted');
    expect(kinds(ranges)).not.toContain('marker-hidden');
  });

  it('decorationRangesFor_ordinalFueraDelCursor_mantieneElNumero', () => {
    // El fallo de la alpha: solo se veia el numero del parrafo con el cursor.
    const ranges = decorationRangesFor('1. uno\n2. dos\n3. tres', 1);

    expect(kinds(ranges).filter((kind) => kind === 'ordinal')).toHaveLength(3);
    expect(kinds(ranges)).not.toContain('marker-hidden');
  });

  it('decorationRangesFor_lineaDelCursor_noOcultaElMarcador', () => {
    // Comportamiento Obsidian: en la linea que se esta editando el marcador se VE.
    const ranges = decorationRangesFor('- uno', 0);

    expect(kinds(ranges)).toContain('bullet');
    expect(kinds(ranges)).not.toContain('marker-hidden');
  });

  it('decorationRangesFor_ordinal_devuelveOrdinal', () => {
    expect(kinds(decorationRangesFor('1. uno', 0))).toContain('ordinal');
    expect(kinds(decorationRangesFor('2) dos', 0))).toContain('ordinal');
  });

  it('decorationRangesFor_listaAnidada_marcaLaSangria', () => {
    expect(kinds(decorationRangesFor('  - uno', 0))).toContain('list-indent');
  });

  it('decorationRangesFor_guionSinEspacio_noEsLista', () => {
    expect(kinds(decorationRangesFor('-uno', 0))).not.toContain('bullet');
  });
});

describe('decorationRangesFor — inline', () => {
  it('decorationRangesFor_dobleAsterisco_devuelveStrong', () => {
    expect(kinds(decorationRangesFor('esto es **fuerte**', 0))).toContain('strong');
  });

  it('decorationRangesFor_guionBajoEnMedioDePalabra_noEsEnfasis', () => {
    // `snake_case` sobrevive, igual que en el parser del chat.
    expect(kinds(decorationRangesFor('usa snake_case_aqui', 0))).not.toContain('em');
  });

  it('decorationRangesFor_guionBajoConFronteras_siEsEnfasis', () => {
    expect(kinds(decorationRangesFor('esto es _flojo_ hoy', 0))).toContain('em');
  });

  it('decorationRangesFor_backticks_devuelveCode', () => {
    expect(kinds(decorationRangesFor('usa `pnpm test` ya', 0))).toContain('code');
  });

  it('decorationRangesFor_enfasisDentroDeCodigo_noSeDecoraDosVeces', () => {
    // El codigo gana: lo de dentro de backticks no es enfasis.
    const ranges = decorationRangesFor('`a **b** c`', 0);

    expect(kinds(ranges)).toEqual(['code']);
  });
});

describe('decorationRangesFor — vallas y encabezados', () => {
  it('decorationRangesFor_dentroDeVallaAbierta_noDecoraNadaMas', () => {
    const ranges = decorationRangesFor('```\n- uno **fuerte**\n```', NO_CURSOR);

    expect(new Set(kinds(ranges))).toEqual(new Set(['fence']));
  });

  it('decorationRangesFor_vallaSinCerrar_decoraHastaElFinal', () => {
    // Tolerante, como el parser del chat.
    const ranges = decorationRangesFor('```ts\nconst a = 1;\nsigue', NO_CURSOR);

    expect(new Set(kinds(ranges))).toEqual(new Set(['fence']));
  });

  it('decorationRangesFor_trasCerrarLaValla_vuelveADecorar', () => {
    const ranges = decorationRangesFor('```\ncodigo\n```\n**fuerte**', NO_CURSOR);

    expect(kinds(ranges)).toContain('strong');
  });

  it('decorationRangesFor_encabezado_devuelveHeadingConSuNivel', () => {
    expect(kinds(decorationRangesFor('## Titulo', 0))).toContain('heading-2');
    expect(kinds(decorationRangesFor('###### Seis', 0))).toContain('heading-6');
  });

  it('decorationRangesFor_encabezadoDeSieteAlmohadillas_noEsEncabezado', () => {
    expect(kinds(decorationRangesFor('####### Siete', 0)).filter((k) => k.startsWith('heading'))).toEqual([]);
  });

  it('decorationRangesFor_textoVacio_devuelveVacio', () => {
    expect(decorationRangesFor('', 0)).toEqual([]);
  });
});

describe('decorationRangesFor — invariantes', () => {
  it('decorationRangesFor_encabezadoSinTextoAun_noEmiteRangoVacio', () => {
    // Medido en el .exe: CodeMirror lanza "Mark decorations may not be empty" y al caerse el plugin el
    // input se queda SIN formato. Se alcanza escribiendo "## " (encabezado sin contenido todavia).
    const ranges = decorationRangesFor('## ', 0);

    expect(ranges.filter((range) => range.to === range.from)).toEqual([]);
    expect(ranges.map((range) => range.kind)).not.toContain('heading-2');
  });

  it('decorationRangesFor_lineaEnBlancoDentroDeUnaValla_noEmiteRangoVacio', () => {
    // El otro caso vacio alcanzable: dentro de una valla se decora la linea COMPLETA, y una linea en
    // blanco mide 0.
    const ranges = decorationRangesFor(['```ts', '', 'const x = 1;', '```'].join('\n'), -1);

    expect(ranges.filter((range) => range.to === range.from)).toEqual([]);
  });

  it('decorationRangesFor_textoVariado_ningunRangoEstaVacio', () => {
    const texto = ['#', '# ', '###### ', '- ', '1. ', '```', '', '```', '**', '``'].join('\n');

    for (const cursor of [-1, 0, 1, 3, 6]) {
      expect(decorationRangesFor(texto, cursor).filter((range) => range.to === range.from)).toEqual([]);
    }
  });

  it('decorationRangesFor_rangosNoSeSolapan', () => {
    // CodeMirror LANZA con decoraciones solapadas y eso deja el input en blanco en runtime.
    const texto = [
      '# Titulo con **fuerte**',
      '- uno `codigo` y _flojo_',
      '  1. anidado **a** _b_',
      '```ts',
      'const x = **no es enfasis**;',
      '```',
      'final _con_ `varios` **marcadores**',
    ].join('\n');

    for (const cursor of [-1, 0, 1, 2, 4, 6]) {
      const ranges = [...decorationRangesFor(texto, cursor)].sort((a, b) => a.from - b.from || a.to - b.to);
      for (let i = 1; i < ranges.length; i += 1) {
        const previous = ranges[i - 1]!;
        const current = ranges[i]!;
        // Anidado (contenido dentro de contenido) no se emite: o van seguidos o son disjuntos.
        expect(current.from).toBeGreaterThanOrEqual(previous.to);
      }
    }
  });

  it('decorationRangesFor_rangosDentroDelTexto', () => {
    const texto = '- uno **fuerte**\n## Dos';
    for (const range of decorationRangesFor(texto, 0)) {
      expect(range.from).toBeGreaterThanOrEqual(0);
      expect(range.to).toBeLessThanOrEqual(texto.length);
      expect(range.to).toBeGreaterThan(range.from);
    }
  });
});
