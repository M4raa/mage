import { describe, expect, it } from 'vitest';
import { appendToolUse } from './engineBlocks';
import { fileTouchesField, fileTouchesOf, type FileTouchAction } from './fileTouches';

describe('fileTouchesOf', () => {
  it.each<[string, Record<string, unknown>, FileTouchAction]>([
    ['Write', { file_path: '/p/a.ts' }, 'created'],
    ['Edit', { file_path: '/p/a.ts' }, 'edited'],
    ['MultiEdit', { file_path: '/p/a.ts' }, 'edited'],
    ['NotebookEdit', { notebook_path: '/p/a.ipynb' }, 'edited'],
    ['Read', { file_path: '/p/a.ts' }, 'read'],
    ['write_to_file', { TargetFile: 'C:\\p\\a.ts' }, 'created'],
    ['replace_file_content', { TargetFile: 'C:\\p\\a.ts' }, 'edited'],
    ['multi_replace_file_content', { TargetFile: 'C:\\p\\a.ts' }, 'edited'],
    ['view_file', { AbsolutePath: 'C:\\p\\a.ts' }, 'read'],
  ])('fileTouchesOf_%s_unaAccion', (tool, input, action) => {
    const path = Object.values(input)[0] as string;

    expect(fileTouchesOf(tool, input)).toEqual([{ path, action }]);
  });

  it('fileTouchesOf_applyPatch_altaActualizacionMovidoYBorrado', () => {
    const changes = [
      { path: '/p/n.ts', kind: { type: 'add' }, diff: '' },
      { path: '/p/u.ts', kind: { type: 'update' }, diff: '' },
      { path: '/p/viejo.ts', kind: { type: 'update', move_path: '/p/nuevo.ts' }, diff: '' },
      { path: '/p/b.ts', kind: { type: 'delete' }, diff: '' },
    ];

    expect(fileTouchesOf('apply_patch', { changes })).toEqual([
      { path: '/p/n.ts', action: 'created' },
      { path: '/p/u.ts', action: 'edited' },
      { path: '/p/nuevo.ts', action: 'edited' },
    ]);
  });

  it('fileTouchesOf_applyPatchMalFormado_vacio', () => {
    expect(fileTouchesOf('apply_patch', { changes: 'x' })).toEqual([]);
  });

  it.each(['Bash', 'Glob', 'Grep', 'WebSearch'])('fileTouchesOf_%s_vacio', (tool) => {
    expect(fileTouchesOf(tool, { command: 'cat a.ts', pattern: '*.ts', path: '/p' })).toEqual([]);
  });

  it('fileTouchesOf_rutaVacia_vacio', () => {
    expect(fileTouchesOf('Write', { file_path: '  ' })).toEqual([]);
  });
});

describe('fileTouchesField', () => {
  it('fileTouchesField_sinToques_objetoVacio', () => {
    expect(fileTouchesField('Bash', {})).toEqual({});
  });

  it('fileTouchesField_conToques_llevaElCampo', () => {
    expect(fileTouchesField('Read', { file_path: '/a' })).toEqual({ fileTouches: [{ path: '/a', action: 'read' }] });
  });
});

describe('appendToolUse', () => {
  it('appendToolUse_applyPatch_guardaSusToques', () => {
    const input = { changes: [{ path: '/p/n.ts', kind: { type: 'add' }, diff: '' }] };

    const blocks = appendToolUse([], { toolUseId: 't1', toolName: 'apply_patch', input }, 'b1');

    const block = blocks[0];
    expect(block?.kind === 'tool' ? block.fileTouches : null).toEqual([{ path: '/p/n.ts', action: 'created' }]);
  });
});
