import { describe, expect, it } from 'vitest';
import type { MemoryFile } from '@shared/memory';
import { buildMemoryView, parseFrontmatter } from './memoryView';

describe('parseFrontmatter', () => {
  it('variantePlana_extraeClavesDeRaizYSeparaCuerpo', () => {
    const content = ['---', 'name: Sistema X', 'description: hace algo', 'type: feedback', '---', '', 'Cuerpo aquí.'].join('\n');

    const { attributes, body } = parseFrontmatter(content);

    expect(attributes.name).toBe('Sistema X');
    expect(attributes.type).toBe('feedback');
    expect(body).toBe('Cuerpo aquí.');
  });

  it('varianteAnidadaMetadata_aplanaLaClaveHoja', () => {
    const content = ['---', 'name: proj-x', 'metadata:', '  node_type: memory', '  type: project', '---', 'Cuerpo.'].join('\n');

    const { attributes } = parseFrontmatter(content);

    expect(attributes.type).toBe('project'); // aplanado desde metadata.type
    expect(attributes.node_type).toBe('memory');
  });

  it('descripcionEntrecomillada_quitaLasComillas', () => {
    const content = ['---', 'description: "texto citado"', '---', 'x'].join('\n');

    expect(parseFrontmatter(content).attributes.description).toBe('texto citado');
  });

  it('sinFrontmatter_atributosVaciosYTodoEsCuerpo', () => {
    const content = 'Solo cuerpo, sin bloque de metadatos.';

    const { attributes, body } = parseFrontmatter(content);

    expect(attributes).toEqual({});
    expect(body).toBe(content);
  });

  it('frontmatterSinCierre_tratadoComoCuerpo', () => {
    const content = ['---', 'name: x', 'nunca cierra'].join('\n');

    const { attributes, body } = parseFrontmatter(content);

    expect(attributes).toEqual({});
    expect(body).toBe(content);
  });
});

describe('buildMemoryView', () => {
  const note = (fileName: string, front: string, body = ''): MemoryFile => ({
    fileName,
    content: `---\n${front}\n---\n${body}`,
  });

  it('separaMemoryMdComoIndiceYNoLoIncluyeEnNotas', () => {
    const files: readonly MemoryFile[] = [
      { fileName: 'MEMORY.md', content: '- [X](x.md) — gancho' },
      note('x.md', 'name: X\ntype: project'),
    ];

    const view = buildMemoryView(files);

    expect(view.indexContent).toBe('- [X](x.md) — gancho');
    expect(view.notes.map((n) => n.fileName)).toEqual(['x.md']);
  });

  it('sinFicheros_notasVaciasEIndiceNulo', () => {
    const view = buildMemoryView([]);

    expect(view.notes).toEqual([]);
    expect(view.indexContent).toBeNull();
  });

  it('tipoNoCatalogado_seClasificaComoOther', () => {
    const view = buildMemoryView([note('a.md', 'name: A\ntype: weird')]);

    expect(view.notes[0]?.type).toBe('other');
    expect(view.notes[0]?.rawType).toBe('weird');
  });

  it('sinName_usaElSlugDelFichero', () => {
    const view = buildMemoryView([note('feedback_cache.md', 'type: feedback')]);

    expect(view.notes[0]?.name).toBe('feedback_cache');
  });

  it('ordenaPorTipoLuegoPorNombre', () => {
    const files = [
      note('z.md', 'name: Zeta\ntype: reference'),
      note('a.md', 'name: Alfa\ntype: user'),
      note('m.md', 'name: Mu\ntype: project'),
    ];

    const view = buildMemoryView(files);

    // user < project < reference (TYPE_ORDER)
    expect(view.notes.map((n) => n.name)).toEqual(['Alfa', 'Mu', 'Zeta']);
  });

  it('wikilinkAFicheroExistente_resuelveAlNombreDeFichero', () => {
    const files = [note('src.md', 'name: Src\ntype: project', 'Ver [[layout_system]] para detalles.'), note('layout_system.md', 'name: L\ntype: project')];

    const src = buildMemoryView(files).notes.find((n) => n.fileName === 'src.md');

    expect(src?.links).toEqual([{ raw: 'layout_system', targetFileName: 'layout_system.md' }]);
  });

  it('wikilinkSinDestino_seConservaConTargetNulo', () => {
    const view = buildMemoryView([note('src.md', 'name: Src\ntype: project', 'Ref a [[no_existe]].')]);

    expect(view.notes[0]?.links).toEqual([{ raw: 'no_existe', targetFileName: null }]);
  });

  it('wikilinkRepetido_seDeduplica', () => {
    const files = [note('src.md', 'name: S\ntype: project', '[[t]] y otra vez [[t]]'), note('t.md', 'name: T\ntype: project')];

    const src = buildMemoryView(files).notes.find((n) => n.fileName === 'src.md');

    expect(src?.links).toHaveLength(1);
  });
});
