import { describe, expect, it } from 'vitest';
import type { CodexTurn } from '@shared/codexTranscript';
import type { TranscriptEntry } from '@shared/transcripts';
import {
  claudeForkLeaf, claudeLastSeen, claudePrompts, codexUserMessages, discardedFrom, resolveClaudePoint, resolveCodexPoint, RewindPointError,
  type CodexUserMessage, type RewindPointRef,
} from './rewindPoints';

type Block = Record<string, unknown>;

function entry(kind: string, uuid: string | null, content: string | Block[], extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    index: 0, uuid, parentUuid: null, isSidechain: false, isMeta: false, timestampMs: null, category: 'turn', kind, summary: '', tokenUsage: null,
    raw: { type: kind, uuid, message: { role: kind, content } }, ...extra,
  };
}

const user = (uuid: string, content: string | Block[] = uuid, extra: Partial<TranscriptEntry> = {}) => entry('user', uuid, content, extra);
const assistant = (uuid: string) => entry('assistant', uuid, [{ type: 'text', text: 'ok' }]);
const toolResult: Block[] = [{ type: 'tool_result', tool_use_id: 't', content: 'x' }];
const ref = (over: Partial<RewindPointRef> = {}): RewindPointRef => ({ userIndex: 0, text: '', nativeId: null, ...over });

describe('claude', () => {
  const branch = [user('p1'), assistant('a1'), user('r1', toolResult), assistant('a2'), user('p2'), assistant('a3')];

  it('claudePrompts_skipsToolResultMetaAndSidechain', () => {
    const entries = [user('p1'), user('m', 'meta', { isMeta: true }), user('s', 'side', { isSidechain: true }), user('r', toolResult), user('noid', 'x', { uuid: null }), user('p2')];

    expect(claudePrompts(entries).map((p) => p.uuid)).toEqual(['p1', 'p2']);
  });

  it('claudePrompts_arrayContentJoinsTextBlocks', () => {
    const entries = [user('p1', [{ type: 'text', text: 'uno' }, { type: 'image' }, { type: 'text', text: 'dos' }])];

    expect(claudePrompts(entries)).toEqual([{ uuid: 'p1', entryIndex: 0, text: 'uno\ndos' }]);
  });

  it('resolveClaudePoint_byNativeId_found', () => {
    const prompts = claudePrompts(branch);

    expect(resolveClaudePoint(prompts, ref({ nativeId: 'p2' })).uuid).toBe('p2');
  });

  it('resolveClaudePoint_unknownNativeId_throwsNotFound', () => {
    const prompts = claudePrompts(branch);

    expect(() => resolveClaudePoint(prompts, ref({ nativeId: 'zzz' }))).toThrow(RewindPointError);
    expect(() => resolveClaudePoint(prompts, ref({ nativeId: 'zzz' }))).toThrow('not_found: userIndex=0 nativeId=zzz');
  });

  it('resolveClaudePoint_nullNativeId_throwsNotFound', () => {
    expect(() => resolveClaudePoint(claudePrompts(branch), ref({ userIndex: 3 }))).toThrow('not_found: userIndex=3 nativeId=null');
  });

  it('claudeLastSeen_empty_throwsEmpty', () => {
    expect(() => claudeLastSeen([])).toThrow(/^empty/);
  });

  it('claudeLastSeen_prompts_lastUuid', () => {
    expect(claudeLastSeen(claudePrompts(branch))).toBe('p2');
  });

  it('claudeForkLeaf_middlePrompt_lastEntryBeforeNextPrompt', () => {
    const prompts = claudePrompts(branch);

    expect(claudeForkLeaf(branch, prompts, prompts[0]!)).toBe('a2');
  });

  it('claudeForkLeaf_lastPrompt_leafOfBranch', () => {
    const prompts = claudePrompts(branch);

    expect(claudeForkLeaf(branch, prompts, prompts[1]!)).toBe('a3');
  });

  it('claudeForkLeaf_lastPromptWithoutAnswer_itself', () => {
    const entries = [user('p1')];
    const prompts = claudePrompts(entries);

    expect(claudeForkLeaf(entries, prompts, prompts[0]!)).toBe('p1');
  });
});

describe('codex', () => {
  const item = (id: string, text: string, clientId: string | null = null) => ({ type: 'userMessage', id, clientId, content: [{ type: 'text', text }] });
  const turns: CodexTurn[] = [
    { id: 't1', items: [item('i0', '<environment_context>x</environment_context>'), item('i1', 'hola', 'c1'), { type: 'agentMessage', id: 'a1', text: 'ok' }] },
    { id: 't2', items: [item('i2', 'segundo', 'c2'), item('i3', 'directo', 'c3')] },
  ];
  const messages = codexUserMessages(turns);

  it('codexUserMessages_skipsInjectedContext_marksOpener', () => {
    expect(messages.map((m) => [m.itemId, m.turnId, m.opensTurn])).toEqual([['i1', 't1', true], ['i2', 't2', true], ['i3', 't2', false]]);
  });

  it('resolveCodexPoint_byClientId', () => {
    expect(resolveCodexPoint(messages, ref({ nativeId: 'c2' })).itemId).toBe('i2');
  });

  it('resolveCodexPoint_byItemId', () => {
    expect(resolveCodexPoint(messages, ref({ nativeId: 'i1' })).turnId).toBe('t1');
  });

  it('resolveCodexPoint_byIndexAndText', () => {
    expect(resolveCodexPoint(messages, ref({ userIndex: 1, text: '  segundo ' })).itemId).toBe('i2');
  });

  it('resolveCodexPoint_indexWithOtherText_throwsNotFound', () => {
    expect(() => resolveCodexPoint(messages, ref({ userIndex: 1, text: 'otro' }))).toThrow('not_found: userIndex=1 nativeId=null');
  });

  it('resolveCodexPoint_steerInsideTurn_throwsMidTurn', () => {
    expect(() => resolveCodexPoint(messages, ref({ nativeId: 'c3' }))).toThrow(/^mid_turn/);
  });
});

describe('discardedFrom', () => {
  it('discardedFrom_secondOfThree_two', () => {
    const list: CodexUserMessage[] = ['a', 'b', 'c'].map((id) => ({ turnId: 't', itemId: id, clientId: null, text: id, opensTurn: true }));

    expect(discardedFrom(list, list[1]!)).toBe(2);
  });

  it('discardedFrom_pointNotInList_throwsWithValue', () => {
    expect(() => discardedFrom([1, 2], 9)).toThrow('9');
  });
});
