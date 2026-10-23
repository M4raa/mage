import { createReadStream, existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptBatch, TranscriptTailPosition } from '@shared/transcripts';
import { TranscriptService } from './transcriptService';
import { BATCH_SIZE } from './transcriptReader';
const dirs: string[] = [];
const temporaryDir = (): string => { const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-a01-'))); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const line = (uuid: string) => JSON.stringify({ type: 'user', uuid, message: { content: uuid } }) + '\n';
const tailOf = (batch: TranscriptBatch): TranscriptTailPosition => ({ bytesRead: batch.bytesReadSoFar, rawLineNumber: batch.rawLineNumber, totalLinesSoFar: batch.totalLinesSoFar });
describe('A01 — cancelar y reanudar transcripción', () => {
  it('A01_cancelarTrasPrimerLote_reanudaSinPerderMensajes', async () => {
    const contents = Array.from({ length: BATCH_SIZE + 50 }, (_, i) => line(String(i))).join('');
    const path = join(temporaryDir(), 'fixture.jsonl');
    writeFileSync(path, contents);
    const service = new TranscriptService({ exists: existsSync, sizeOf: (file) => statSync(file).size,
      createReadStream: (file, start = 0) => createReadStream(file, { start }) });
    const controller = new AbortController();
    const reader = service.openStream(path, controller.signal);
    const first = (await reader.next()).value as TranscriptBatch;
    controller.abort();
    await reader.return(undefined);
    const recovered = [...first.entries];
    for await (const batch of service.openStream(path, new AbortController().signal, tailOf(first))) recovered.push(...batch.entries);
    expect(recovered.map((entry) => entry.uuid)).toEqual(Array.from({ length: BATCH_SIZE + 50 }, (_, i) => String(i)));
  });

  it.each(['\n', '\r\n'])('checkpointConUTF8Y%s_fragmentado_noPierdeNiDuplica', async ending => {
    const ids = Array.from({ length: BATCH_SIZE + 50 }, (_, i) => `á😀-${i}`);
    const lines = ids.map(uuid => JSON.stringify({ type: 'user', uuid, message: { content: uuid } }) + ending);
    const path = join(temporaryDir(), 'utf8.jsonl'); writeFileSync(path, lines.join(''));
    const service = new TranscriptService({ exists: existsSync, sizeOf: file => statSync(file).size,
      createReadStream: (file, start = 0) => createReadStream(file, { start, highWaterMark: 31 }) });
    const controller = new AbortController(); const reader = service.openStream(path, controller.signal);
    const first = (await reader.next()).value as TranscriptBatch;
    expect(first.bytesReadSoFar).toBe(Buffer.byteLength(lines.slice(0, first.entries.length).join('')));
    controller.abort(); await reader.return(undefined);
    const recovered = [...first.entries];
    for await (const batch of service.openStream(path, new AbortController().signal, tailOf(first))) recovered.push(...batch.entries);
    expect(recovered.map(entry => entry.uuid)).toEqual(ids);
  });
});
