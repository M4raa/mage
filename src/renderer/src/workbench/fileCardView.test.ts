import { describe, expect, it } from 'vitest';
import { fileCardFrom } from './fileCardView';
import type { Block } from './types';

const toolBlock = (over: Record<string, unknown>): Block =>
  ({
    kind: 'tool', id: 'b1', toolUseId: 'u1', tool: 'Write', toolClass: 'file', command: '', meta: '', isError: false,
    output: [], filePath: '/p/a.md', diff: null, writtenContent: null, artifact: null, artifactDraft: null, parentToolUseId: null, ...over,
  }) as unknown as Block;

describe('fileCardFrom', () => {
  it('fileCardFrom_writeOk_created', () => {
    const card = fileCardFrom(toolBlock({}));

    expect(card).toEqual({ path: '/p/a.md', name: 'a.md', action: 'created' });
  });

  it('fileCardFrom_editOk_edited', () => {
    const card = fileCardFrom(toolBlock({ tool: 'Edit' }));

    expect(card?.action).toBe('edited');
  });

  it('fileCardFrom_read_null', () => {
    const card = fileCardFrom(toolBlock({ tool: 'Read' }));

    expect(card).toBeNull();
  });

  it('fileCardFrom_conError_null', () => {
    const card = fileCardFrom(toolBlock({ isError: true }));

    expect(card).toBeNull();
  });

  it('fileCardFrom_deSubagente_null', () => {
    const card = fileCardFrom(toolBlock({ parentToolUseId: 'task-1' }));

    expect(card).toBeNull();
  });

  it('fileCardFrom_noEsTool_null', () => {
    const card = fileCardFrom({ kind: 'user', id: 'u1', text: 'hola', time: '', attachments: [], nativeId: null });

    expect(card).toBeNull();
  });

  it('fileCardFrom_rutaWindows_nombreTrasLaBarra', () => {
    const card = fileCardFrom(toolBlock({ filePath: 'C:\\a\\b\\c.ts' }));

    expect(card?.name).toBe('c.ts');
  });
});
