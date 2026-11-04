import { describe, expect, it } from 'vitest';
import type { MentionCandidate } from '@shared/mentions';
import type { CreatedFile } from './createdFilesView';
import type { MentionResolution } from '@shared/mentions';
import { addMention, applyResolution, failedMentions, conversationMatches, insertMention, mentionQueryAt, mentionRows, reconcileMentions, removeMentionToken } from './mentionDraft';

const candidate = (relPath: string): MentionCandidate => ({ relPath, absPath: `/p/${relPath}`, kind: 'text', bytes: 1 });
const created = (path: string, failed = false): CreatedFile => ({ path, name: path, dir: '', blockId: 'b', failed });

describe('mentionQueryAt', () => {
  it('mentionQueryAt_atStart_returnsQuery', () => expect(mentionQueryAt('@no', 3)).toEqual({ start: 0, query: 'no' }));
  it('mentionQueryAt_afterSpace_returnsQuery', () => expect(mentionQueryAt('mira @src/a', 11)).toEqual({ start: 5, query: 'src/a' }));
  it('mentionQueryAt_emailLike_null', () => expect(mentionQueryAt('a@b', 3)).toBeNull());
  it('mentionQueryAt_spaceAfterAt_null', () => expect(mentionQueryAt('@a b', 4)).toBeNull());
  it('mentionQueryAt_emptyQuery_returnsEmpty', () => expect(mentionQueryAt('hola @', 6)).toEqual({ start: 5, query: '' }));
  it('mentionQueryAt_cursorBeforeAt_null', () => expect(mentionQueryAt('hola @x', 3)).toBeNull());
});

describe('insertMention', () => {
  it('insertMention_replacesQueryAddsSpace', () => {
    const result = insertMention('mira @not ya', { start: 5, query: 'not' }, 'notas.md');

    expect(result).toEqual({ text: 'mira @notas.md  ya', cursor: 15 });
  });
});

describe('reconcileMentions', () => {
  it('reconcileMentions_tokenRemoved_dropsMention', () => {
    expect(reconcileMentions('hola', [candidate('a.md')])).toEqual([]);
  });

  it('reconcileMentions_unchanged_sameReference', () => {
    const mentions = [candidate('a.md')];

    expect(reconcileMentions('ve @a.md ', mentions)).toBe(mentions);
  });

  it('reconcileMentions_prefixOfOtherPath_notConfused', () => {
    expect(reconcileMentions('@src/ab ', [candidate('src/a')])).toEqual([]);
  });
});

describe('removeMentionToken', () => {
  it('removeMentionToken_removesTrailingSpace', () => expect(removeMentionToken('ve @a.md hoy', 'a.md')).toBe('ve hoy'));
  it('removeMentionToken_absent_unchanged', () => expect(removeMentionToken('ve hoy', 'a.md')).toBe('ve hoy'));
});

describe('addMention', () => {
  it('addMention_duplicate_ignored', () => {
    const mentions = [candidate('a.md')];

    expect(addMention(mentions, candidate('a.md'))).toBe(mentions);
  });

  it('addMention_new_appended', () => expect(addMention([], candidate('a.md'))).toHaveLength(1));
});

describe('conversationMatches', () => {
  it('conversationMatches_insideCwdOnly', () => {
    const files = [created('/w/p/a.md'), created('/w/otro/b.md'), created('/w/p/src/c.ts')];

    expect(conversationMatches(files, '/w/p', '', 5)).toEqual(['a.md', 'src/c.ts']);
  });

  it('conversationMatches_windowsCaseInsensitive', () => {
    expect(conversationMatches([created('c:\\Work\\Proj\\Notas.md')], 'C:\\work\\proj', 'not', 5)).toEqual(['Notas.md']);
  });

  it('conversationMatches_failedSkipped', () => {
    expect(conversationMatches([created('/w/p/a.md', true)], '/w/p', '', 5)).toEqual([]);
  });

  it('conversationMatches_siblingFolderSamePrefix_excluded', () => {
    expect(conversationMatches([created('/w/p2/a.md')], '/w/p', '', 5)).toEqual([]);
  });
});

describe('mentionRows', () => {
  it('mentionRows_conversationFirstThenFilesWithoutRepeats', () => {
    const rows = mentionRows(['b.md'], [candidate('a.md'), candidate('b.md')]);

    expect(rows.map((row) => `${row.section}:${row.relPath}`)).toEqual(['conversation:b.md', 'files:a.md']);
  });

  it('mentionRows_conversationFileNotInIndex_candidateNull', () => {
    expect(mentionRows(['x.md'], [])[0]?.candidate).toBeNull();
  });

  it('mentionRows_conversationFileInIndex_reusesCandidate', () => {
    const indexed = candidate('b.md');

    expect(mentionRows(['b.md'], [indexed])[0]?.candidate).toBe(indexed);
  });
});

const resolution = (outcomes: MentionResolution['outcomes'], text = '', attachments: MentionResolution['attachments'] = []): MentionResolution => ({ text, attachments, outcomes });

describe('failedMentions', () => {
  it('failedMentions_missingAndOutside_listed', () => {
    const failed = failedMentions(resolution([
      { relPath: 'a.md', outcome: 'missing', kind: null },
      { relPath: 'b.md', outcome: 'outsideFolder', kind: null },
      { relPath: 'c.md', outcome: 'inline', kind: 'text' },
    ]));

    expect([...failed]).toEqual([['a.md', 'missing'], ['b.md', 'outsideFolder']]);
  });

  it('failedMentions_allResolved_empty', () => {
    expect(failedMentions(resolution([{ relPath: 'c.md', outcome: 'pathOnly', kind: 'binary' }])).size).toBe(0);
  });
});

describe('applyResolution', () => {
  it('applyResolution_appendsTextAndAttachments', () => {
    const own = { mediaType: 'image/png' as const, data: 'AAAA' };
    const extra = { mediaType: 'application/pdf' as const, data: 'BBBB' };

    const result = applyResolution('mira @a.md', [own], resolution([], ' BLOQUE', [extra]));

    expect(result).toEqual({ text: 'mira @a.md BLOQUE', attachments: [own, extra] });
  });
});
