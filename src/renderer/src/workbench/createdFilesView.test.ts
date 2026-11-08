import { describe, expect, it } from 'vitest';
import { createdFileFrom, createdFilesOf, touchedFilesOf } from './createdFilesView';
import type { Block } from './types';

function toolBlock(overrides: Partial<Extract<Block, { kind: 'tool' }>> = {}): Block {
  return {
    kind: 'tool',
    id: 'b1',
    toolUseId: 't1',
    tool: 'Write',
    toolClass: 'write',
    command: 'Write plan.md',
    meta: 'ok',
    isError: false,
    output: [],
    filePath: 'C:\\proj\\plan.md',
    diff: null,
    writtenContent: ['# Plan'],
    artifact: null,
    artifactDraft: null,
    ...overrides,
  } as Block;
}

describe('createdFileFrom', () => {
  it('createdFileFrom_writeConRuta_devuelveNombreYCarpeta', () => {
    expect(createdFileFrom(toolBlock())).toEqual({
      path: 'C:\\proj\\plan.md',
      name: 'plan.md',
      dir: 'C:\\proj',
      blockId: 'b1',
      failed: false,
    });
  });

  it('createdFileFrom_rutaPosix_partePorLaBarraCorrecta', () => {
    // El renderer no tiene `node:path` y la ruta puede venir de cualquiera de los tres SO: el separador
    // se deduce de la propia ruta.
    expect(createdFileFrom(toolBlock({ filePath: '/home/u/proj/notas.txt' }))?.name).toBe('notas.txt');
    expect(createdFileFrom(toolBlock({ filePath: '/home/u/proj/notas.txt' }))?.dir).toBe('/home/u/proj');
  });

  it('createdFileFrom_soloNombre_carpetaVacia', () => {
    expect(createdFileFrom(toolBlock({ filePath: 'plan.md' }))).toMatchObject({ dir: '', name: 'plan.md' });
  });

  it('createdFileFrom_toolQueNoEsWrite_null', () => {
    // Decision del usuario: solo ficheros NUEVOS. `Edit` modifica algo que ya existia.
    expect(createdFileFrom(toolBlock({ tool: 'Edit' }))).toBeNull();
  });

  it('createdFileFrom_writeSinRuta_null', () => {
    expect(createdFileFrom(toolBlock({ filePath: null }))).toBeNull();
    expect(createdFileFrom(toolBlock({ filePath: '   ' }))).toBeNull();
  });

  it('createdFileFrom_bloqueQueNoEsTool_null', () => {
    expect(createdFileFrom({ kind: 'system', id: 's1', text: 'algo' })).toBeNull();
  });

  it('createdFileFrom_escrituraConError_seListaMarcada', () => {
    // Un fichero que el agente creyo crear y no existe no puede verse igual que uno bueno.
    expect(createdFileFrom(toolBlock({ isError: true }))?.failed).toBe(true);
  });
});

describe('createdFilesOf', () => {
  it('createdFilesOf_variosFicheros_elMasRecientePrimero', () => {
    const blocks = [
      toolBlock({ id: 'b1', filePath: 'C:\\proj\\a.md' }),
      toolBlock({ id: 'b2', filePath: 'C:\\proj\\b.md' }),
    ];

    expect(createdFilesOf(blocks).map((f) => f.name)).toEqual(['b.md', 'a.md']);
  });

  it('createdFilesOf_mismoFicheroDosVeces_unaSolaEntradaYGanaLaUltima', () => {
    const blocks = [toolBlock({ id: 'b1' }), toolBlock({ id: 'b2', isError: true })];

    const files = createdFilesOf(blocks);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ blockId: 'b2', failed: true });
  });

  it('createdFilesOf_ficheroReescritoAlFinal_vuelveAlPrincipioDeLaLista', () => {
    // Un `Map` conserva el sitio de la PRIMERA insercion de cada clave: sin borrar antes de re-insertar,
    // el fichero recien tocado salia el ULTIMO pese a ser lo mas reciente.
    const blocks = [
      toolBlock({ id: 'b1', filePath: 'C:\\proj\\a.md' }),
      toolBlock({ id: 'b2', filePath: 'C:\\proj\\b.md' }),
      toolBlock({ id: 'b3', filePath: 'C:\\proj\\a.md' }),
    ];

    expect(createdFilesOf(blocks).map((f) => f.name)).toEqual(['a.md', 'b.md']);
  });

  it('createdFilesOf_hiloSinEscrituras_listaVacia', () => {
    expect(createdFilesOf([{ kind: 'system', id: 's1', text: 'x' }])).toEqual([]);
  });
});

describe('touchedFilesOf', () => {
  it('touchedFilesOf_editAndRead_included', () => {
    const blocks = [
      toolBlock({ id: 'w', tool: 'Write', filePath: '/p/new.ts' }),
      toolBlock({ id: 'e', tool: 'Edit', filePath: '/p/edit.ts' }),
      toolBlock({ id: 'm', tool: 'MultiEdit', filePath: null, command: '/p/multi.ts' }),
      toolBlock({ id: 'n', tool: 'NotebookEdit', filePath: '/p/nb.ipynb' }),
      toolBlock({ id: 'r', tool: 'Read', filePath: null, command: '/p/read.ts' }),
      toolBlock({ id: 'b', tool: 'Bash', filePath: null, command: 'ls /p' }),
    ];

    expect(touchedFilesOf(blocks).map((f) => f.path)).toEqual(['/p/read.ts', '/p/nb.ipynb', '/p/multi.ts', '/p/edit.ts', '/p/new.ts']);
    expect(createdFilesOf(blocks).map((f) => f.path)).toEqual(['/p/new.ts']);
  });

  it('touchedFilesOf_duplicatePath_once', () => {
    const blocks = [toolBlock({ id: 'r', tool: 'Read', filePath: '/p/a.ts' }), toolBlock({ id: 'e', tool: 'Edit', filePath: '/p/a.ts' })];

    expect(touchedFilesOf(blocks)).toHaveLength(1);
    expect(touchedFilesOf(blocks)[0]?.blockId).toBe('e');
  });

  it('touchedFilesOf_truncatedSummary_skipped', () => {
    expect(touchedFilesOf([toolBlock({ tool: 'Read', filePath: null, command: '/p/muy/larga…' })])).toEqual([]);
  });
});
