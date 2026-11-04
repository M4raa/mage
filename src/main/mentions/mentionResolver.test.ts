import { describe, expect, it } from 'vitest';
import { resolveMentions, type MentionResolverDeps } from './mentionResolver';
import { previewMention, PREVIEW_IMAGE_MAX_BYTES } from './mentionPreview';

const CWD = '/proj';

interface FakeFs {
  readonly files: Map<string, Buffer>;
  readonly links: Map<string, string>;
}

function makeDeps(fake: FakeFs, trusted = true): MentionResolverDeps {
  const real = (path: string): string | null => {
    const target = fake.links.get(path) ?? path;
    return fake.files.has(target) || target === CWD ? target : null;
  };
  return {
    isTrusted: () => trusted,
    realpath: real,
    platform: 'linux',
    stat: async (path) => {
      const file = fake.files.get(path);
      return file === undefined ? null : { bytes: file.length };
    },
    readHead: async (path, bytes) => fake.files.get(path)?.subarray(0, bytes) ?? null,
    readFile: async (path) => {
      const file = fake.files.get(path);
      if (file === undefined) throw new Error(`no existe ${path}`);
      return file;
    },
  };
}

const fakeFs = (entries: Record<string, string | Buffer>, links: Record<string, string> = {}): FakeFs => ({
  files: new Map(Object.entries(entries).map(([path, content]) => [path, Buffer.from(content)])),
  links: new Map(Object.entries(links)),
});

const ref = (relPath: string) => ({ absPath: `${CWD}/${relPath}`, relPath });
const params = (provider: string, ...relPaths: string[]) => ({ cwd: CWD, accountDir: '/acc', provider, refs: relPaths.map(ref) });

describe('resolveMentions', () => {
  it('resolveMentions_textClaude_inlineWithHeader', async () => {
    const deps = makeDeps(fakeFs({ '/proj/src/a.ts': 'let a = 1;' }));

    const result = await resolveMentions(params('claude', 'src/a.ts'), deps);

    expect(result.text).toBe('\n\n```\n// src/a.ts\nlet a = 1;\n```');
    expect(result.outcomes).toEqual([{ relPath: 'src/a.ts', outcome: 'inline', kind: 'text' }]);
  });

  it('resolveMentions_imageClaude_attached', async () => {
    const deps = makeDeps(fakeFs({ '/proj/logo.png': 'PNGDATA' }));

    const result = await resolveMentions(params('claude', 'logo.png'), deps);

    expect(result.attachments).toEqual([{ mediaType: 'image/png', data: Buffer.from('PNGDATA').toString('base64') }]);
    expect(result.outcomes[0]).toEqual({ relPath: 'logo.png', outcome: 'attached', kind: 'image' });
  });

  it('resolveMentions_pdfClaude_attachedAsPdf', async () => {
    const deps = makeDeps(fakeFs({ '/proj/a.pdf': '%PDF-1.4' }));

    const result = await resolveMentions(params('claude', 'a.pdf'), deps);

    expect(result.attachments[0]?.mediaType).toBe('application/pdf');
    expect(result.text).toBe('');
  });

  it('resolveMentions_pdfCodex_pathOnly', async () => {
    const deps = makeDeps(fakeFs({ '/proj/a.pdf': '%PDF-1.4' }));

    const result = await resolveMentions(params('codex', 'a.pdf'), deps);

    expect(result.attachments).toEqual([]);
    expect(result.text).toContain('/proj/a.pdf');
    expect(result.outcomes[0]?.outcome).toBe('pathOnly');
  });

  it('resolveMentions_symlinkOutside_outsideFolder', async () => {
    const deps = makeDeps(fakeFs({ '/home/secret.txt': 'secreto' }, { '/proj/link.txt': '/home/secret.txt' }));

    const result = await resolveMentions(params('claude', 'link.txt'), deps);

    expect(result.text).toBe('');
    expect(result.outcomes).toEqual([{ relPath: 'link.txt', outcome: 'outsideFolder', kind: null }]);
  });

  it('resolveMentions_deleted_missing', async () => {
    const result = await resolveMentions(params('claude', 'gone.ts'), makeDeps(fakeFs({})));

    expect(result.outcomes).toEqual([{ relPath: 'gone.ts', outcome: 'missing', kind: null }]);
  });

  it('resolveMentions_untrusted_allOutside', async () => {
    const deps = makeDeps(fakeFs({ '/proj/a.ts': 'x', '/proj/b.ts': 'y' }), false);

    const result = await resolveMentions(params('claude', 'a.ts', 'b.ts'), deps);

    expect(result.outcomes.map((o) => o.outcome)).toEqual(['outsideFolder', 'outsideFolder']);
    expect(result.text).toBe('');
  });

  it('resolveMentions_orderPreserved', async () => {
    const deps = makeDeps(fakeFs({ '/proj/a.ts': 'AAA', '/proj/b.ts': 'BBB' }));

    const result = await resolveMentions(params('claude', 'b.ts', 'a.ts'), deps);

    expect(result.text.indexOf('BBB')).toBeLessThan(result.text.indexOf('AAA'));
    expect(result.outcomes.map((o) => o.relPath)).toEqual(['b.ts', 'a.ts']);
  });

  it('resolveMentions_badRef_throwsWithValue', async () => {
    const deps = makeDeps(fakeFs({}));
    const bad = { cwd: CWD, accountDir: '', provider: 'claude', refs: [{ absPath: '', relPath: 'x' }] };

    await expect(resolveMentions(bad, deps)).rejects.toThrow(/relPath/);
    await expect(resolveMentions({ ...bad, refs: 'nope' as never }, deps)).rejects.toThrow(/nope/);
  });
});

describe('previewMention', () => {
  const at = (relPath: string) => ({ cwd: CWD, accountDir: '/acc', absPath: `${CWD}/${relPath}` });

  it('previewMention_smallImage_dataUrl', async () => {
    const deps = makeDeps(fakeFs({ '/proj/a.png': 'PNG' }));

    expect(await previewMention(at('a.png'), deps)).toEqual({ kind: 'image', dataUrl: `data:image/png;base64,${Buffer.from('PNG').toString('base64')}` });
  });

  it('previewMention_bigImage_none', async () => {
    const deps = makeDeps(fakeFs({ '/proj/a.png': Buffer.alloc(PREVIEW_IMAGE_MAX_BYTES + 1) }));

    expect(await previewMention(at('a.png'), deps)).toEqual({ kind: 'none' });
  });

  it('previewMention_text_first20Lines', async () => {
    const text = Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n');
    const deps = makeDeps(fakeFs({ '/proj/a.txt': text }));

    const preview = await previewMention(at('a.txt'), deps);

    expect(preview.kind === 'text' && preview.head.split('\n')).toHaveLength(20);
  });

  it('previewMention_outside_none', async () => {
    const deps = makeDeps(fakeFs({ '/home/s.txt': 'x' }, { '/proj/s.txt': '/home/s.txt' }));

    expect(await previewMention(at('s.txt'), deps)).toEqual({ kind: 'none' });
  });
});
