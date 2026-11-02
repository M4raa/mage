import { createReadStream, existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptBatch } from '@shared/transcripts';
import { readFoldedTranscript as readFolded, tailOf } from '../../testing/transcriptRead';
import { TranscriptService } from './transcriptService';
import { BATCH_FLUSH_MS, BATCH_SIZE } from './transcriptReader';
const dirs: string[] = [];
const temporaryDir = (): string => { const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-a01-'))); dirs.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const line = (uuid: string) => JSON.stringify({ type: 'user', uuid, message: { content: uuid } }) + '\n';
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


const runIncrementalScenario = async (): Promise<void> => {
  const path = join(temporaryDir(), 'incremental.jsonl');
  const service = new TranscriptService({ exists: existsSync, sizeOf: file => statSync(file).size,
    createReadStream: (file, start = 0) => createReadStream(file, { start, highWaterMark: 7 }) });
  const complete = line('ñ😀');
  writeFileSync(path, line('á😀') + '\n\n' + complete.slice(0, 12));
  const first = await readFolded(service, path);
  expect(first.last.rawLineNumber).toBe(3);
  expect(first.errors).toEqual([]);
  writeFileSync(path, line('á😀') + '\n\n' + complete);
  const second = await readFolded(service, path, tailOf(first.last));
  expect(second.entries.map(entry => [entry.uuid, entry.index])).toEqual([['ñ😀', 3]]);
  expect(second.last.totalLinesSoFar).toBe(2);
  writeFileSync(path, line('nuevo'));
  const third = await readFolded(service, path, tailOf(second.last));
  expect(third.reset).toBe(true);
  expect(third.entries.map(entry => entry.uuid)).toEqual(['nuevo']);
  expect(third.last.rawLineNumber).toBe(1);
};

it('F1_9d_archivoReal_UTF8Fragmentado_blancasColaYTruncado', runIncrementalScenario);

// Reproducción determinista de la carga: cada `Date.now()` avanza más que BATCH_FLUSH_MS, así que cada
// línea sale en su propio lote seguido de un lote final vacío. Con el «último lote» de antes, fallaba.
it('F1_9d_lotesCortadosPorTiempo_resetEnPrimerLoteYEntradasPlegadas', async () => {
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += BATCH_FLUSH_MS + 1));
  await runIncrementalScenario();
});
