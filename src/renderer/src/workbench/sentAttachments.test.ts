import { describe, expect, it } from 'vitest';
import { splitSentAttachments } from './sentAttachments';

const fenced = (path: string, content: string, fence = '```'): string => `\n\n${fence}\n// ${path}\n${content}\n${fence}`;
const pathOnly = (path: string): string => `\n\n[Fichero mencionado: ${path}. Léelo con tus herramientas si lo necesitas.]`;

describe('splitSentAttachments', () => {
  it('splitSentAttachments_sinAdjuntos_mismoTexto', () => {
    const text = 'hola mundo';

    const result = splitSentAttachments(text);

    expect(result).toEqual({ body: text, files: [] });
  });

  it('splitSentAttachments_unoEnLinea_cuerpoYFichaConBytes', () => {
    const text = `mira esto${fenced('notas.md', 'ñ')}`;

    const result = splitSentAttachments(text);

    expect(result).toEqual({ body: 'mira esto', files: [{ path: 'notas.md', name: 'notas.md', bytes: 2 }] });
  });

  it('splitSentAttachments_soloRuta_fichaSinBytes', () => {
    const text = `mira${pathOnly('C:\\p\\img.pdf')}`;

    const result = splitSentAttachments(text);

    expect(result).toEqual({ body: 'mira', files: [{ path: 'C:\\p\\img.pdf', name: 'img.pdf', bytes: null }] });
  });

  it('splitSentAttachments_dosSeguidos_enOrdenDeMencion', () => {
    const text = `mira${fenced('a.md', 'A')}${pathOnly('/p/b.pdf')}`;

    const result = splitSentAttachments(text);

    expect(result.body).toBe('mira');
    expect(result.files.map((f) => f.name)).toEqual(['a.md', 'b.pdf']);
  });

  it('splitSentAttachments_vallaDeCuatro_conTresDentro', () => {
    const content = 'antes\n```\ncodigo\n```\ndespues';
    const text = `mira${fenced('a.md', content, '````')}`;

    const result = splitSentAttachments(text);

    expect(result.body).toBe('mira');
    expect(result.files).toEqual([{ path: 'a.md', name: 'a.md', bytes: new TextEncoder().encode(content).length }]);
  });

  it('splitSentAttachments_bloqueDeCodigoDelUsuarioSinRuta_seQuedaComoTexto', () => {
    const text = 'mira\n\n```\nconst a = 1;\n```';

    const result = splitSentAttachments(text);

    expect(result).toEqual({ body: text, files: [] });
  });

  it('splitSentAttachments_textoVacio_vacio', () => {
    const result = splitSentAttachments('');

    expect(result).toEqual({ body: '', files: [] });
  });
});
