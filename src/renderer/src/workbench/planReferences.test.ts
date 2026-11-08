import { describe, expect, it } from 'vitest';
import {
  anchorTextMatcher,
  associatedDocumentPaths,
  buildReferenceIndex,
  extractReferenceTokens,
  indexDocumentAnchors,
  panelEntries,
  planDocuments,
  resolveReference,
} from './planReferences';
import type { Block } from './types';

const writeBlock = (id: string, filePath: string, isError = false): Block =>
  ({ kind: 'tool', id, tool: 'Write', filePath, isError, command: filePath }) as unknown as Block;
const userBlock = (id: string, text: string): Block => ({ kind: 'user', id, text }) as unknown as Block;
const agentBlock = (id: string, text: string): Block =>
  ({ kind: 'agent', id, runs: [{ code: false, text }], streaming: false }) as unknown as Block;

describe('extractReferenceTokens', () => {
  it('extractReferenceTokens_threeForms', () => {
    const text = 'Ver §3.4, #20 y F0.4.';

    const keys = extractReferenceTokens(text).map((token) => token.key);

    expect(keys).toEqual(['§3.4', '#20', 'F0.4']);
  });

  it('extractReferenceTokens_insideWord_ignored', () => {
    const tokens = extractReferenceTokens('aF0.4 y x#20 y 3.4 y 20');

    expect(tokens).toEqual([]);
  });

  it('extractReferenceTokens_trailingComma_excluded', () => {
    const text = 'mira F0.4, luego';

    const [token] = extractReferenceTokens(text);

    expect(text.slice(token?.start, token?.end)).toBe('F0.4');
  });
});

describe('indexDocumentAnchors', () => {
  it('indexDocumentAnchors_headingSection_keySection', () => {
    const anchors = indexDocumentAnchors('d', '## 3.4 Identidad\n### H2 uno\n## F0.4 Arranque');

    expect(anchors.map((a) => [a.key, a.line, a.label])).toEqual([
      ['§3.4', 0, '3.4 Identidad'],
      ['H2', 1, 'H2 uno'],
      ['F0.4', 2, 'F0.4 Arranque'],
    ]);
  });

  it('indexDocumentAnchors_listOrdinal_noSection', () => {
    const anchors = indexDocumentAnchors('d', '1. primero\n- 2.1 algo\n- #20 punto\n* T3: tarea');

    expect(anchors.map((a) => a.key)).toEqual(['#20', 'T3']);
  });

  it('indexDocumentAnchors_fencedCode_ignored', () => {
    const anchors = indexDocumentAnchors('d', '```md\n## 9.9 Falso\n```\n## 1.1 Real');

    expect(anchors.map((a) => a.key)).toEqual(['§1.1']);
  });

  it('indexDocumentAnchors_boldIdentifier_found', () => {
    const anchors = indexDocumentAnchors('d', '- **#20** — algo\n## **F0.4** `x`');

    expect(anchors.map((a) => a.key)).toEqual(['#20', 'F0.4']);
  });
});

describe('resolveReference', () => {
  it('resolveReference_unique_returnsAnchor', () => {
    const index = buildReferenceIndex(indexDocumentAnchors('a', '## F0.4 Uno'));

    expect(resolveReference(index, 'F0.4')?.docId).toBe('a');
  });

  it('resolveReference_ambiguousTwoDocs_null', () => {
    const index = buildReferenceIndex([...indexDocumentAnchors('a', '### H2 uno'), ...indexDocumentAnchors('b', '### H2 dos')]);

    expect(resolveReference(index, 'H2')).toBeNull();
  });

  it('resolveReference_missing_null', () => {
    const index = buildReferenceIndex([]);

    expect(resolveReference(index, '§1.1')).toBeNull();
  });
});

describe('associatedDocumentPaths', () => {
  const CWD = 'C:\\proj';

  it('associatedDocumentPaths_createdAndCited_dedup', () => {
    const blocks = [
      writeBlock('w1', 'C:\\proj\\plan.md'),
      writeBlock('w2', 'C:\\proj\\fallo.md', true),
      userBlock('u1', 'revisa docs/otro.md y C:/PROJ/plan.md'),
      agentBlock('a1', 'ok `docs\\otro.md`'),
    ];

    const paths = associatedDocumentPaths(blocks, CWD);

    expect(paths).toEqual(['C:/proj/plan.md', 'C:/proj/docs/otro.md']);
  });

  it('associatedDocumentPaths_outsideCwd_excluded', () => {
    const blocks = [writeBlock('w1', 'C:\\otra\\x.md'), userBlock('u1', 'mira ../fuera.md y https://x.com/a.md y src/a.ts')];

    expect(associatedDocumentPaths(blocks, CWD)).toEqual([]);
  });

  it('associatedDocumentPaths_atMention_included', () => {
    const blocks = [userBlock('u1', 'lee @notas/plan.md por favor')];

    expect(associatedDocumentPaths(blocks, '/home/u/proj')).toEqual(['/home/u/proj/notas/plan.md']);
  });
});

describe('planDocuments', () => {
  it('planDocuments_exitPlanMode_virtualDoc', () => {
    const blocks = [
      { kind: 'tool', id: 'b7', tool: 'ExitPlanMode', planText: '# Plan\n## 1.1 A' },
      { kind: 'tool', id: 'b8', tool: 'ExitPlanMode' },
      { kind: 'tool', id: 'b9', tool: 'Bash', planText: 'x' },
    ] as unknown as Block[];

    expect(planDocuments(blocks)).toEqual([{ docId: 'plan:b7', title: 'Plan', text: '# Plan\n## 1.1 A' }]);
  });
});

describe('anchorTextMatcher', () => {
  it('anchorTextMatcher_sectionKey_matchesWithOrWithoutMark', () => {
    const matcher = anchorTextMatcher('§3.4');

    expect([matcher.test('3.4 Identidad'), matcher.test('§3.4 Identidad'), matcher.test('3.45 x'), matcher.test('F3.4')]).toEqual([true, true, false, false]);
  });

  it('anchorTextMatcher_letterKey_escapesDots', () => {
    const matcher = anchorTextMatcher('F0.4');

    expect([matcher.test('F0.4 Arranque'), matcher.test('F0x4'), matcher.test('F0.4: x')]).toEqual([true, false, true]);
  });
});

describe('panelEntries', () => {
  it('panelEntries_createdCitedAndPlans_inThatOrderWithoutDuplicates', () => {
    const blocks = [
      writeBlock('w1', 'C:/proj/plan.md'),
      userBlock('u1', 'mira @plan.md y @otro.md'),
      { kind: 'tool', id: 'p1', tool: 'ExitPlanMode', planText: '# P' },
    ] as unknown as Block[];

    const entries = panelEntries(blocks, 'C:/proj');

    expect(entries.map((e) => e.docId)).toEqual(['C:/proj/plan.md', 'C:/proj/otro.md', 'plan:p1']);
  });

  it('panelEntries_secciones_cadaFicheroEnLaMasFuerteYElMasRecientePrimero', () => {
    const tool = (id: string, toolName: string, fileTouches: readonly { path: string; action: string }[], isError = false) =>
      ({ kind: 'tool', id, tool: toolName, isError, filePath: null, command: '', fileTouches });
    const blocks = [
      tool('b1', 'Write', [{ path: 'C:/proj/a.ts', action: 'created' }]),
      tool('b2', 'Read', [{ path: 'C:/proj/r.ts', action: 'read' }]),
      tool('b3', 'Edit', [{ path: 'C:/proj/e.ts', action: 'edited' }]),
      tool('b4', 'Read', [{ path: 'C:/proj/a.ts', action: 'read' }]),
      tool('b5', 'apply_patch', [{ path: 'C:/proj/n.ts', action: 'created' }, { path: 'C:/proj/r.ts', action: 'edited' }]),
      userBlock('u1', 'mira @notas.md'),
      { kind: 'tool', id: 'p1', tool: 'ExitPlanMode', planText: '# P' },
    ] as unknown as Block[];

    const entries = panelEntries(blocks, 'C:/proj');

    expect(entries.map((e) => [e.kind === 'file' ? e.section : 'plan', e.docId])).toEqual([
      ['created', 'C:/proj/n.ts'],
      ['created', 'C:/proj/a.ts'],
      ['edited', 'C:/proj/r.ts'],
      ['edited', 'C:/proj/e.ts'],
      ['mentioned', 'C:/proj/notas.md'],
      ['plan', 'plan:p1'],
    ]);
  });

  it('panelEntries_bloqueSinFileTouches_seClasificaPorSuToolComoAntes', () => {
    const blocks = [
      { kind: 'tool', id: 'b1', tool: 'Read', isError: false, filePath: 'C:/proj/r.ts', command: '' },
      { kind: 'tool', id: 'b2', tool: 'Bash', isError: false, filePath: null, command: 'cat C:/proj/x.ts' },
    ] as unknown as Block[];

    expect(panelEntries(blocks, 'C:/proj').map((e) => (e.kind === 'file' ? [e.section, e.docId] : null))).toEqual([['read', 'C:/proj/r.ts']]);
  });
});
