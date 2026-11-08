import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBatch, TranscriptEntry } from '@shared/transcripts';
import { readActiveBranch, readActiveBranchEntries } from './activeBranchReader';
import type { BranchReadOptions } from './transcriptService';

const OPTIONS: BranchReadOptions = { onMissingParent: () => undefined };

function entry(index: number): TranscriptEntry {
  return { index, uuid: `u${index}`, parentUuid: null, isSidechain: false, isMeta: false, timestampMs: null, category: 'turn', kind: 'user', summary: '', tokenUsage: null, raw: {} };
}

function batch(entries: readonly TranscriptEntry[], extra: Partial<TranscriptBatch> = {}): TranscriptBatch {
  return { entries, errors: [], isFinal: false, totalLinesSoFar: 0, bytesReadSoFar: 0, rawLineNumber: 0, ...extra };
}

function fakeService(batches: readonly TranscriptBatch[]) {
  const openBranchStream = vi.fn(async function* (..._args: unknown[]) {
    yield* batches;
  });
  return { openBranchStream: openBranchStream as never, spy: openBranchStream };
}

describe('readActiveBranchEntries', () => {
  it('readActiveBranchEntries_twoBatches_concatenates', async () => {
    const { openBranchStream } = fakeService([batch([entry(0)]), batch([entry(1), entry(2)], { isFinal: true })]);

    const entries = await readActiveBranchEntries({ openBranchStream }, '/t.jsonl', OPTIONS);

    expect(entries.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it('readActiveBranchEntries_resetBatch_replaces', async () => {
    const { openBranchStream } = fakeService([batch([entry(0), entry(1)]), batch([entry(5)], { reset: true })]);

    const entries = await readActiveBranchEntries({ openBranchStream }, '/t.jsonl', OPTIONS);

    expect(entries.map((e) => e.index)).toEqual([5]);
  });

  it('readActiveBranchEntries_passesPendingCut', async () => {
    const { openBranchStream, spy } = fakeService([batch([])]);
    const options: BranchReadOptions = { ...OPTIONS, pendingCutUuid: 'cut-1' };

    await readActiveBranchEntries({ openBranchStream }, '/t.jsonl', options);

    expect(spy).toHaveBeenCalledWith('/t.jsonl', expect.any(AbortSignal), { bytesRead: 0, rawLineNumber: 0, totalLinesSoFar: 0 }, options);
  });

  it('readActiveBranch_batchWithErrors_countsAndDoesNotThrow', async () => {
    const errors = [{ lineNumber: 3, message: 'x' }];
    const { openBranchStream } = fakeService([batch([entry(0)], { errors }), batch([], { errors })]);

    const read = await readActiveBranch({ openBranchStream }, '/t.jsonl', OPTIONS);

    expect(read.entries).toHaveLength(1);
    expect(read.errorCount).toBe(2);
  });
});
