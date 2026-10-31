import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBatch } from '@shared/transcripts';
import { tailOf } from '@testing/transcriptRead';
import { BRANCH_CACHE_LIMIT, TranscriptService, type BranchReadOptions } from './transcriptService';

type Line = Record<string, unknown>;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rewound-branch.json');

const line = (obj: Line): string => JSON.stringify(obj) + '\n';

const user = (uuid: string, parent: string | null, text: string): Line =>
  ({ type: 'user', uuid, parentUuid: parent, isSidechain: false, message: { role: 'user', content: text } });

const assistant = (uuid: string, parent: string | null, id: string): Line =>
  ({ type: 'assistant', uuid, parentUuid: parent, isSidechain: false, message: { role: 'assistant', id, content: [{ type: 'text', text: 'ok' }] } });

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

const uuids = (batch: TranscriptBatch): string[] =>
  batch.entries.flatMap((e) => (e.uuid === null ? [] : [e.uuid]));

// Servicio en memoria: `content` es el fichero entero y cambia entre lecturas.
function setup(): { service: () => TranscriptService; set: (text: string) => void; add: (...lines: Line[]) => void; onMissingParent: ReturnType<typeof vi.fn> } {
  let content = '';
  const service = (): TranscriptService => new TranscriptService({
    exists: () => true,
    sizeOf: () => Buffer.byteLength(content),
    createReadStream: (_p, start) => Readable.from([Buffer.from(content).subarray(start ?? 0).toString('utf8')]),
    delay: async () => {},
  });
  return {
    service,
    set: (text) => { content = text; },
    add: (...lines) => { content += lines.map(line).join(''); },
    onMissingParent: vi.fn(),
  };
}

const read = async (service: TranscriptService, path: string, from: Parameters<TranscriptService['openBranchStream']>[2], options: BranchReadOptions, signal = new AbortController().signal): Promise<TranscriptBatch[]> =>
  collect(service.openBranchStream(path, signal, from, options));

describe('TranscriptService.openBranchStream', () => {
  it('openBranchStream_rewoundFixture_singleFinalBatchWith17Nodes', async () => {
    const env = setup();
    const lines = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Line[];
    env.set(lines.map(line).join(''));

    const batches = await read(env.service(), 'f', undefined, { onMissingParent: env.onMissingParent });

    expect(batches).toHaveLength(1);
    expect(batches[0]!.isFinal).toBe(true);
    expect(uuids(batches[0]!)).toHaveLength(17);
    expect(batches[0]!.reset).toBeUndefined();
  });

  it('openBranchStream_continuationTail_appendsWithoutReset', async () => {
    const env = setup();
    const service = env.service();
    const options = { onMissingParent: env.onMissingParent };
    env.add(user('u1', null, 'hola'), assistant('a1', 'u1', 'm1'));
    const [first] = await read(service, 'f', undefined, options);
    env.add(user('u2', 'a1', 'otra'), assistant('a2', 'u2', 'm2'));

    const batches = await read(service, 'f', tailOf(first!), options);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.reset).toBeUndefined();
    expect(uuids(batches[0]!)).toEqual(['u2', 'a2']);
  });

  it('openBranchStream_rewindBetweenReads_rereadsWithReset', async () => {
    const env = setup();
    const service = env.service();
    const options = { onMissingParent: env.onMissingParent };
    env.add(user('u1', null, 'hola'), assistant('a1', 'u1', 'm1'), user('u2', 'a1', 'dos'), assistant('a2', 'u2', 'm2'));
    const [first] = await read(service, 'f', undefined, options);
    env.add(user('u3', 'a1', 'tres'), assistant('a3', 'u3', 'm3'));

    const batches = await read(service, 'f', tailOf(first!), options);

    expect(batches[0]!.reset).toBe(true);
    expect(uuids(batches[0]!)).toEqual(['u1', 'a1', 'u3', 'a3']);
  });

  it('openBranchStream_tailWithoutCache_rereadsWithReset', async () => {
    const env = setup();
    const options = { onMissingParent: env.onMissingParent };
    env.add(user('u1', null, 'hola'), assistant('a1', 'u1', 'm1'));
    const [first] = await read(env.service(), 'f', undefined, options);
    env.add(user('u2', 'a1', 'otra'));

    const batches = await read(env.service(), 'f', tailOf(first!), options);

    expect(batches[0]!.reset).toBe(true);
    expect(uuids(batches[0]!)).toEqual(['u1', 'a1', 'u2']);
  });

  it('openBranchStream_pendingCut_rereadsWithResetAndEndsBeforeTarget', async () => {
    const env = setup();
    const service = env.service();
    env.add(user('u1', null, 'hola'), assistant('a1', 'u1', 'm1'), user('u2', 'a1', 'dos'), assistant('a2', 'u2', 'm2'));
    const [first] = await read(service, 'f', undefined, { onMissingParent: env.onMissingParent });

    const batches = await read(service, 'f', tailOf(first!), { onMissingParent: env.onMissingParent, pendingCutUuid: 'u2' });

    expect(batches[0]!.reset).toBe(true);
    expect(uuids(batches[0]!)).toEqual(['u1', 'a1']);
  });

  it('openBranchStream_afterCutNewMessage_appendsWithoutReset', async () => {
    const env = setup();
    const service = env.service();
    env.add(user('u1', null, 'hola'), assistant('a1', 'u1', 'm1'), user('u2', 'a1', 'dos'), assistant('a2', 'u2', 'm2'));
    const [first] = await read(service, 'f', undefined, { onMissingParent: env.onMissingParent });
    const [cut] = await read(service, 'f', tailOf(first!), { onMissingParent: env.onMissingParent, pendingCutUuid: 'u2' });
    env.add(user('u4', 'a1', 'cuatro'), assistant('a4', 'u4', 'm4'));

    const batches = await read(service, 'f', tailOf(cut!), { onMissingParent: env.onMissingParent });

    expect(batches[0]!.reset).toBeUndefined();
    expect(uuids(batches[0]!)).toEqual(['u4', 'a4']);
  });

  it('openBranchStream_missingParent_reportsUuid', async () => {
    const env = setup();
    env.add(user('u1', 'ghost', 'hola'), assistant('a1', 'u1', 'm1'));

    const batches = await read(env.service(), 'f', undefined, { onMissingParent: env.onMissingParent });

    expect(uuids(batches[0]!)).toEqual(['u1', 'a1']);
    expect(env.onMissingParent).toHaveBeenCalledWith('ghost');
  });

  it('openBranchStream_cycle_rejectsWithUuid', async () => {
    const env = setup();
    env.add(user('u1', 'a1', 'hola'), assistant('a1', 'u1', 'm1'));

    await expect(read(env.service(), 'f', undefined, { onMissingParent: env.onMissingParent })).rejects.toThrow(/u1|a1/);
  });

  it('openBranchStream_abortedBeforeStart_yieldsNothing', async () => {
    const env = setup();
    env.add(user('u1', null, 'hola'));
    const controller = new AbortController();
    controller.abort();

    const batches = await read(env.service(), 'f', undefined, { onMissingParent: env.onMissingParent }, controller.signal);

    expect(batches).toHaveLength(0);
  });

  it('openBranchStream_cacheOverLimit_forgetsOldest', async () => {
    const env = setup();
    const service = env.service();
    const options = { onMissingParent: env.onMissingParent };
    env.add(user('u1', null, 'hola'), assistant('a1', 'u1', 'm1'));
    const paths = Array.from({ length: BRANCH_CACHE_LIMIT + 1 }, (_, i) => `f${i}`);
    const tails = new Map<string, ReturnType<typeof tailOf>>();
    for (const path of paths) {
      const [batch] = await read(service, path, undefined, options);
      tails.set(path, tailOf(batch!));
    }
    env.add(user('u2', 'a1', 'otra'));

    const [oldest] = await read(service, 'f0', tails.get('f0'), options);
    const [newest] = await read(service, `f${BRANCH_CACHE_LIMIT}`, tails.get(`f${BRANCH_CACHE_LIMIT}`), options);

    expect(oldest!.reset).toBe(true);
    expect(newest!.reset).toBeUndefined();
  });
});
