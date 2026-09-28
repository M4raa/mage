import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, type MdBlock } from './markdown';

// Helpers de asercion compactos (el AST es verboso; extraemos lo esencial por caso).
function firstBlock(src: string): MdBlock {
  const blocks = parseMarkdown(src);
  if (blocks[0] === undefined) throw new Error('sin bloques');
  return blocks[0];
}

describe('parseMarkdown', () => {
  it('parseMarkdown_parrafoSimple_devuelveParrafo', () => {
    const block = firstBlock('hola mundo');
    expect(block.type).toBe('paragraph');
  });

  it('parseMarkdown_encabezado_devuelveHeadingConNivel', () => {
    const block = firstBlock('## Título aquí');
    expect(block).toMatchObject({ type: 'heading', level: 2 });
  });

  it('parseMarkdown_seisAlmohadillas_nivel6', () => {
    expect(firstBlock('###### h6')).toMatchObject({ type: 'heading', level: 6 });
  });

  it('parseMarkdown_reglaHorizontal_devuelveHr', () => {
    expect(firstBlock('---')).toMatchObject({ type: 'hr' });
    expect(firstBlock('***')).toMatchObject({ type: 'hr' });
  });

  it('parseMarkdown_guionAisladoNoEsHr_esParrafo', () => {
    // Un solo guion no es hr (evita confundir texto con separador).
    expect(firstBlock('- item').type).toBe('list');
    expect(firstBlock('texto - con guion').type).toBe('paragraph');
  });

  it('parseMarkdown_codeFence_capturaLenguajeYCuerpoSinReparsear', () => {
    const block = firstBlock('```ts\nconst a = 1; // **no** es bold\n```');
    expect(block).toMatchObject({ type: 'code', lang: 'ts', text: 'const a = 1; // **no** es bold' });
  });

  it('parseMarkdown_codeFenceSinCerrar_llegaHastaElFinal', () => {
    const block = firstBlock('```\nlinea1\nlinea2');
    expect(block).toMatchObject({ type: 'code', text: 'linea1\nlinea2' });
  });

  it('parseMarkdown_listaNoOrdenada_devuelveItems', () => {
    const block = firstBlock('- uno\n- dos\n- tres');
    if (block.type !== 'list') throw new Error('no es lista');
    expect(block.ordered).toBe(false);
    expect(block.items).toHaveLength(3);
  });

  it('parseMarkdown_listaOrdenada_conservaInicio', () => {
    const block = firstBlock('3. tres\n4. cuatro');
    expect(block).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('parseMarkdown_listaAnidada_generaSublista', () => {
    const block = firstBlock('- padre\n  - hijo\n  - hijo2');
    if (block.type !== 'list') throw new Error('no es lista');
    const firstItem = block.items[0];
    if (firstItem === undefined) throw new Error('sin item');
    const nested = firstItem.children.find((b) => b.type === 'list');
    if (nested === undefined || nested.type !== 'list') throw new Error('no genero sublista');
    // `toBeDefined()` pasaba con una sublista VACIA: lo que hay que fijar es que los hijos esten
    // dentro de ella, que es justo lo que puede romperse al tocar el parser.
    expect(nested.items).toHaveLength(2);
    // Se serializa el item entero y se busca el texto: fijar la forma exacta del arbol de inlines
    // acoplaria el test al parser, y lo que importa aqui es que el contenido llegue DENTRO de la
    // sublista y no se pierda por el camino.
    expect(JSON.stringify(nested.items[0])).toContain('hijo');
    expect(JSON.stringify(nested.items[1])).toContain('hijo2');
  });

  it('parseMarkdown_tablaGfm_devuelveCabeceraYFilas', () => {
    const block = firstBlock('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    if (block.type !== 'table') throw new Error('no es tabla');
    expect(block.header).toHaveLength(2);
    expect(block.rows).toHaveLength(2);
  });

  it('parseMarkdown_blockquote_reparseaContenido', () => {
    const block = firstBlock('> cita\n> con dos lineas');
    expect(block.type).toBe('blockquote');
  });

  it('parseMarkdown_variosBloques_separaPorLineasEnBlanco', () => {
    const blocks = parseMarkdown('párrafo uno\n\n## Título\n\n- a\n- b');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'list']);
  });

  it('parseMarkdown_textoVacio_sinBloques', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });

  it('parseMarkdown_lineasLargasSinEspacios_noRompe_esParrafo', () => {
    const long = 'a'.repeat(5000);
    expect(firstBlock(long)).toMatchObject({ type: 'paragraph' });
  });
});

describe('parseInline', () => {
  it('parseInline_negrita_devuelveStrong', () => {
    const runs = parseInline('esto es **fuerte** vale');
    expect(runs.some((r) => r.type === 'strong')).toBe(true);
  });

  it('parseInline_cursiva_devuelveEm', () => {
    expect(parseInline('*eso*').some((r) => r.type === 'em')).toBe(true);
  });

  it('parseInline_codigoInline_devuelveCode', () => {
    const runs = parseInline('usa `npm test` ya');
    const code = runs.find((r) => r.type === 'code');
    expect(code).toMatchObject({ type: 'code', text: 'npm test' });
  });

  it('parseInline_codigoInlineNoReparseaEnfasis', () => {
    const runs = parseInline('`a **b** c`');
    expect(runs).toEqual([{ type: 'code', text: 'a **b** c' }]);
  });

  it('parseInline_guionBajoEnPalabra_noEsCursiva', () => {
    // snake_case no debe convertirse en enfasis.
    const runs = parseInline('foo_bar_baz');
    expect(runs.every((r) => r.type === 'text')).toBe(true);
  });

  it('parseInline_enlace_devuelveHrefYLabel', () => {
    const runs = parseInline('ver [Mage](https://x.y) aqui');
    const link = runs.find((r) => r.type === 'link');
    expect(link).toMatchObject({ type: 'link', href: 'https://x.y' });
  });

  it('parseInline_tachado_devuelveDel', () => {
    expect(parseInline('~~no~~').some((r) => r.type === 'del')).toBe(true);
  });

  it('parseInline_delimitadorSinCerrar_esTextoLiteral', () => {
    const runs = parseInline('esto ** no cierra');
    expect(runs.every((r) => r.type === 'text')).toBe(true);
  });

  it('parseInline_escape_conservaCaracterLiteral', () => {
    const runs = parseInline('literal \\*asterisco\\*');
    expect(runs).toEqual([{ type: 'text', text: 'literal *asterisco*' }]);
  });

  it('parseInline_barraAntesDeLetra_seConserva', () => {
    expect(parseInline('C:\\Users\\usuario\\x')).toEqual([{ type: 'text', text: 'C:\\Users\\usuario\\x' }]);
  });

  it('parseInline_barraAntesDePuntuacion_escapa', () => {
    expect(parseInline('\\* y \\\\ y \\_')).toEqual([{ type: 'text', text: '* y \\ y _' }]);
  });

  it('parseInline_barraAlFinal_seConserva', () => {
    expect(parseInline('fin\\')).toEqual([{ type: 'text', text: 'fin\\' }]);
  });

  it('parseInline_negritaYCursivaHermanas_ambasSeParsean', () => {
    const runs = parseInline('**fuerte** y *suave*');
    expect(runs.some((r) => r.type === 'strong')).toBe(true);
    expect(runs.some((r) => r.type === 'em')).toBe(true);
  });

  it('parseInline_negritaConCodigoDentro_anida', () => {
    const runs = parseInline('**usa `x` aqui**');
    const strong = runs.find((r) => r.type === 'strong');
    if (strong === undefined || strong.type !== 'strong') throw new Error('sin strong');
    expect(strong.children.some((c) => c.type === 'code')).toBe(true);
  });
});
