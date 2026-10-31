// Decision (caso 10): un padre inexistente corta la cadena con aviso (onMissingParent); no lanza,
// porque una transcripcion truncada tiene que poder leerse.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptEntry } from '@shared/transcripts';
import { computeActiveBranch, extendActiveBranch } from './activeBranch';
import { parseTranscriptLine } from './normalize';

type Line = Record<string, unknown>;
type Block = Record<string, unknown>;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rewound-branch.json');

function entriesOf(lines: readonly Line[], firstLineNumber = 1): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  lines.forEach((line, i) => {
    const parsed = parseTranscriptLine(line, firstLineNumber + i);
    if (parsed.ok) out.push(parsed.entry);
  });
  return out;
}

function user(uuid: string, parent: string | null, content: string | Block[]): Line {
  return { type: 'user', uuid, parentUuid: parent, isSidechain: false, message: { role: 'user', content } };
}

function assistant(uuid: string, parent: string | null, messageId: string, content: string | Block[]): Line {
  return { type: 'assistant', uuid, parentUuid: parent, isSidechain: false, message: { role: 'assistant', content, id: messageId } };
}

function system(uuid: string, parent: string | null, subtype: string): Line {
  return { type: 'system', uuid, parentUuid: parent, isSidechain: false, subtype, content: 'x' };
}

function attachment(uuid: string, parent: string | null): Line {
  return { type: 'attachment', uuid, parentUuid: parent, isSidechain: false };
}

function compactBoundary(uuid: string, logicalParent: string): Line {
  return { type: 'system', subtype: 'compact_boundary', uuid, parentUuid: null, logicalParentUuid: logicalParent, isSidechain: false };
}

function meta(type: string): Line {
  return { type };
}

const toolUse = (id: string): Block => ({ type: 'tool_use', id, name: 'Bash', input: {} });
const toolResult = (id: string): Block => ({ type: 'tool_result', tool_use_id: id, content: 'ok' });
const text = (value: string): Block => ({ type: 'text', text: value });

// Ids de los bloques tool_use (id) o tool_result (tool_use_id) de una entrada.
function toolIdsIn(entry: TranscriptEntry, type: 'tool_use' | 'tool_result'): string[] {
  const content = (entry.raw as { message: { content: string | Block[] } }).message.content;
  if (typeof content === 'string') return [];
  return content.filter((b) => b.type === type).map((b) => String(type === 'tool_use' ? b.id : b.tool_use_id));
}

const uuidsOf = (entries: readonly TranscriptEntry[]): string[] => entries.flatMap((e) => (e.uuid === null ? [] : [e.uuid]));
const noop = (): void => undefined;

describe('computeActiveBranch', () => {
  it('computeActiveBranch_rewoundFixture_returns17NodesWithoutOldLeaf', () => {
    const lines = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Line[];
    const entries = entriesOf(lines);
    const onMissingParent = vi.fn();

    const result = computeActiveBranch(entries, { onMissingParent });

    const uuids = uuidsOf(result.entries);
    expect(uuids).toHaveLength(17);
    expect(result.entries).toHaveLength(43);
    for (const prefix of ['1cb7ef04', '302dadbb', '618ec005', 'a6d96c1e', '824039ae', '56be02d6']) {
      expect(uuids.filter((u) => u.startsWith(prefix))).toEqual([]);
    }
    const leaf = entries.find((e) => e.uuid?.startsWith('4723684c'));
    expect(result.state.leafIndex).toBe(leaf?.index);
    expect(onMissingParent).not.toHaveBeenCalled();
  });

  it('computeActiveBranch_parallelToolCalls_includesSiblingsAndResults', () => {
    const entries = entriesOf([
      user('u1', null, 'hola'),
      assistant('a1', 'u1', 'm1', [{ type: 'thinking', thinking: 'x' }]),
      assistant('a2', 'a1', 'm1', [toolUse('t1')]),
      assistant('a3', 'a1', 'm1', [toolUse('t2')]),
      user('r1', 'a2', [toolResult('t1')]),
      user('r2', 'a3', [toolResult('t2')]),
      assistant('a4', 'r1', 'm2', [text('fin')]),
    ]);

    const result = computeActiveBranch(entries, { onMissingParent: noop });

    expect(uuidsOf(result.entries)).toEqual(['u1', 'a1', 'a2', 'a3', 'r1', 'r2', 'a4']);
    const used = result.entries.flatMap((e) => (e.kind === 'assistant' ? toolIdsIn(e, 'tool_use') : []));
    const answered = new Set(result.entries.flatMap((e) => (e.kind === 'user' ? toolIdsIn(e, 'tool_result') : [])));
    expect(used).toEqual(['t1', 't2']);
    expect(used.filter((id) => !answered.has(id))).toEqual([]);
  });

  it('computeActiveBranch_localCommandAfterLeaf_isIncluded', () => {
    const entries = entriesOf([user('u1', null, 'hola'), assistant('a1', 'u1', 'm1', 'ok'), user('u2', 'a1', '/cost'), system('s1', 'u2', 'local_command')]);

    const result = computeActiveBranch(entries, { onMissingParent: noop });

    expect(uuidsOf(result.entries)).toContain('s1');
  });

  it('computeActiveBranch_abandonedUserLaterInFile_isExcluded', () => {
    const entries = entriesOf([
      user('u1', null, 'hola'),
      assistant('a1', 'u1', 'm1', 'ok'),
      user('u2', 'a1', 'activa'),
      user('u3', 'a1', 'abandonada'),
      assistant('a2', 'u2', 'm2', 'fin'),
    ]);

    const result = computeActiveBranch(entries, { onMissingParent: noop });

    expect(uuidsOf(result.entries)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('computeActiveBranch_pendingCutWithParallelCallsAfter_excludesFromTarget', () => {
    const entries = entriesOf([
      user('u1', null, 'hola'),
      assistant('a1', 'u1', 'm1', 'ok'),
      user('u2', 'a1', 'objetivo'),
      assistant('p1', 'u2', 'm9', [toolUse('t9')]),
      assistant('p2', 'p1', 'm9', [toolUse('t10')]),
      user('r9', 'p1', [toolResult('t9')]),
      user('r10', 'p2', [toolResult('t10')]),
      assistant('a3', 'r10', 'm10', 'fin'),
    ]);

    const result = computeActiveBranch(entries, { pendingCutUuid: 'u2', onMissingParent: noop });

    expect(uuidsOf(result.entries)).toEqual(['u1', 'a1']);
  });

  it('computeActiveBranch_pendingCutUnknown_throwsWithUuid', () => {
    const entries = entriesOf([user('u1', null, 'hola'), assistant('a1', 'u1', 'm1', 'ok')]);

    expect(() => computeActiveBranch(entries, { pendingCutUuid: 'nope', onMissingParent: noop })).toThrow(/nope/);
  });

  it('computeActiveBranch_cycle_throwsWithUuid', () => {
    const entries = entriesOf([user('u1', 'a1', 'hola'), assistant('a1', 'u1', 'm1', 'ok')]);

    expect(() => computeActiveBranch(entries, { onMissingParent: noop })).toThrow(/u1|a1/);
  });

  it('computeActiveBranch_forwardLogicalParent_cutsWithWarning', () => {
    const entries = entriesOf([compactBoundary('s1', 'at1'), attachment('at1', 's1'), user('u1', 'at1', 'hola'), assistant('a1', 'u1', 'm1', 'ok')]);
    const onMissingParent = vi.fn();

    const result = computeActiveBranch(entries, { onMissingParent });

    expect(uuidsOf(result.entries)).toEqual(['s1', 'at1', 'u1', 'a1']);
    expect(onMissingParent).toHaveBeenCalledTimes(1);
    expect(onMissingParent).toHaveBeenCalledWith('at1');
  });

  it('computeActiveBranch_backwardLogicalParent_followsIt', () => {
    const entries = entriesOf([
      user('u0', null, 'antes'),
      assistant('a0', 'u0', 'm0', 'ok'),
      compactBoundary('s1', 'a0'),
      user('u1', 's1', 'despues'),
      assistant('a1', 'u1', 'm1', 'ok'),
    ]);
    const onMissingParent = vi.fn();

    const result = computeActiveBranch(entries, { onMissingParent });

    expect(uuidsOf(result.entries)).toEqual(['u0', 'a0', 's1', 'u1', 'a1']);
    expect(onMissingParent).not.toHaveBeenCalled();
  });

  it('computeActiveBranch_empty_returnsEmptyWithoutLeaf', () => {
    const result = computeActiveBranch([], { onMissingParent: noop });

    expect(result.entries).toEqual([]);
    expect(result.state.leafIndex).toBe(-1);
  });

  it('computeActiveBranch_singleUser_returnsIt', () => {
    const result = computeActiveBranch(entriesOf([user('u1', null, 'hola')]), { onMissingParent: noop });

    expect(uuidsOf(result.entries)).toEqual(['u1']);
    expect(result.state.leafIndex).toBe(0);
  });

  it('computeActiveBranch_missingParent_stopsAndReportsUuid', () => {
    const onMissingParent = vi.fn();
    const entries = entriesOf([user('u1', 'ghost', 'hola'), assistant('a1', 'u1', 'm1', 'ok')]);

    const result = computeActiveBranch(entries, { onMissingParent });

    expect(uuidsOf(result.entries)).toEqual(['u1', 'a1']);
    expect(onMissingParent).toHaveBeenCalledTimes(1);
    expect(onMissingParent).toHaveBeenCalledWith('ghost');
  });

  it('computeActiveBranch_metadataAndSidechain_keepsMetadataDropsSidechain', () => {
    const side: Line = { ...user('side', 'u1', 'lateral'), isSidechain: true };
    const entries = entriesOf([meta('custom-title'), user('u1', null, 'hola'), side, assistant('a1', 'u1', 'm1', 'ok')]);

    const result = computeActiveBranch(entries, { onMissingParent: noop });

    expect(result.entries.map((e) => e.kind)).toEqual(['custom-title', 'user', 'assistant']);
    expect(uuidsOf(result.entries)).not.toContain('side');
  });
});

describe('extendActiveBranch', () => {
  const base = (): TranscriptEntry[] => entriesOf([user('u1', null, 'hola'), assistant('a1', 'u1', 'm1', 'ok')]);

  it('extendActiveBranch_continuation_appendsNewNodes', () => {
    const state = computeActiveBranch(base(), { onMissingParent: noop }).state;
    const next = entriesOf([user('u2', 'a1', 'sigue'), assistant('a2', 'u2', 'm2', 'fin'), meta('custom-title')], 2);

    const result = extendActiveBranch(state, next, noop);

    expect(result.kind).toBe('append');
    if (result.kind !== 'append') throw new Error('unreachable');
    expect(result.entries).toHaveLength(3);
    expect(result.state.leafIndex).toBe(next[1]?.index);
  });

  it('extendActiveBranch_rewindBetweenReads_requestsRebuild', () => {
    const first = entriesOf([user('u1', null, 'hola'), assistant('a1', 'u1', 'm1', 'ok'), user('u2', 'a1', 'x'), assistant('a2', 'u2', 'm2', 'y')]);
    const state = computeActiveBranch(first, { onMissingParent: noop }).state;

    const result = extendActiveBranch(state, entriesOf([user('u3', 'a1', 'rewind')], 4), noop);

    expect(result.kind).toBe('rebuild');
  });

  it('extendActiveBranch_forwardLogicalParentInNew_requestsRebuild', () => {
    const state = computeActiveBranch(entriesOf([user('u1', null, 'hola'), assistant('a1', 'u1', 'm1', 'ok')]), { onMissingParent: noop }).state;
    const next = entriesOf([compactBoundary('s2', 'at2'), attachment('at2', 's2'), user('u2', 'at2', 'sigue')], 2);

    const result = extendActiveBranch(state, next, noop);

    expect(result.kind).toBe('rebuild');
  });

  it('extendActiveBranch_newRoot_requestsRebuild', () => {
    const state = computeActiveBranch(base(), { onMissingParent: noop }).state;

    const result = extendActiveBranch(state, entriesOf([user('u9', null, 'raiz')], 2), noop);

    expect(result.kind).toBe('rebuild');
  });

  it('extendActiveBranch_onlyAttachments_appendsThoseHangingFromBranch', () => {
    const state = computeActiveBranch(base(), { onMissingParent: noop }).state;

    const result = extendActiveBranch(state, entriesOf([attachment('at1', 'a1'), meta('custom-title'), attachment('at2', 'ghost')], 2), noop);

    expect(result.kind).toBe('append');
    if (result.kind !== 'append') throw new Error('unreachable');
    expect(result.entries.map((e) => e.uuid ?? e.kind)).toEqual(['at1', 'custom-title']);
    expect(result.state.leafIndex).toBe(state.leafIndex);
  });

  it('extendActiveBranch_noPreviousLeaf_requestsRebuild', () => {
    const state = computeActiveBranch([], { onMissingParent: noop }).state;

    const result = extendActiveBranch(state, entriesOf([user('u1', null, 'hola')]), noop);

    expect(result.kind).toBe('rebuild');
  });

  it('extendActiveBranch_doesNotMutateState', () => {
    const state = computeActiveBranch(base(), { onMissingParent: noop }).state;
    const sizeBefore = state.indexByUuid.size;

    extendActiveBranch(state, entriesOf([user('u2', 'a1', 'sigue'), assistant('a2', 'u2', 'm2', 'fin')], 2), noop);

    expect(state.indexByUuid.size).toBe(sizeBefore);
  });
});
