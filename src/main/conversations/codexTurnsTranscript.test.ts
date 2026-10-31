import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptCodexLine, type CodexTurn } from '@shared/codexTranscript';
import type { TranscriptBatch } from '@shared/transcripts';
import { CodexHistoryService } from './codexHistory';
import { codexTranscriptSource, codexTurnsBatches } from './codexTurnsTranscript';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ROLLOUT = join(__dirname, '..', '..', 'shared', 'fixtures', 'codex-rollout.jsonl');
const THREAD = '11111111-2222-3333-4444-555555555555';
const VIGENTES: CodexTurn[] = [{
  id: 't1',
  items: [
    { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Turno vigente' }] },
    { type: 'agentMessage', id: 'a1', text: 'Respuesta vigente' },
  ],
}];

const fsDeps = {
  exists: existsSync,
  listDir: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  statFile: (path: string) => ({ mtimeMs: statSync(path).mtimeMs, sizeBytes: statSync(path).size }),
  readPrefix: (path: string, max: number) => readFileSync(path, 'utf8').slice(0, max),
  readSuffix: (path: string, max: number) => readFileSync(path, 'utf8').slice(-max),
};

// Una cuenta de Codex en disco con el rollout original y, si `withSegment`, un segmento (lo que deja un `thread/revert`).
function seedThread(home: string, withSegment: boolean): void {
  const day = join(home, 'sessions', '2026', '10', '05');
  mkdirSync(day, { recursive: true });
  copyFileSync(ROLLOUT, join(day, `rollout-2026-10-05T08-00-00-${THREAD}.jsonl`));
  if (!withSegment) return;
  const meta = JSON.stringify({ timestamp: '2026-10-06T00:00:00.000Z', type: 'session_meta', payload: { id: THREAD, cwd: 'C:\\proyecto' } }) + '\n';
  writeFileSync(join(day, `rollout-2026-10-05T08-00-00-${THREAD}_aaaaaaaa-0000-0000-0000-000000000001.jsonl`), meta);
}

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'mage-codex-turns-'));
  roots.push(root);
  return root;
}

async function collect(batches: AsyncIterable<TranscriptBatch>): Promise<TranscriptBatch[]> {
  const out: TranscriptBatch[] = [];
  for await (const batch of batches) out.push(batch);
  return out;
}

describe('codexTranscriptSource', () => {
  it('codexTranscriptSource_conSegmentos_turnosSinMirarElRollout', () => {
    const findRollout = vi.fn();

    const source = codexTranscriptSource({ hasSegments: () => true, findRollout }, 'H', 'T');

    expect(source).toEqual({ kind: 'codexTurns', home: 'H', threadId: 'T' });
    expect(findRollout).not.toHaveBeenCalled();
  });

  it('codexTranscriptSource_sinSegmentos_rolloutConSuAdaptador', () => {
    const source = codexTranscriptSource({ hasSegments: () => false, findRollout: () => 'C:\\r.jsonl' }, 'H', 'T');

    expect(source).toEqual({ kind: 'file', filePath: 'C:\\r.jsonl', adapt: adaptCodexLine, activeBranch: false });
  });

  it('codexTranscriptSource_hiloInexistente_null', () => {
    expect(codexTranscriptSource({ hasSegments: () => false, findRollout: () => null }, 'H', 'T')).toBeNull();
  });
});

describe('codexTurnsBatches', () => {
  it('codexTurnsBatches_turnos_unLoteFinalConReset', async () => {
    const batches = await collect(codexTurnsBatches(async () => VIGENTES));

    expect(batches).toHaveLength(1);
    expect(batches[0]?.reset).toBe(true);
    expect(batches[0]?.isFinal).toBe(true);
    expect(batches[0]?.entries).toHaveLength(2);
    expect(batches[0]?.errors).toHaveLength(0);
  });

  it('codexTurnsBatches_rpcFalla_propagaElError', async () => {
    const failing = codexTurnsBatches(async () => { throw new Error('Codex rechazo thread/turns/list: x'); });

    await expect(collect(failing)).rejects.toThrow('Codex rechazo thread/turns/list: x');
  });
});

describe('reabrir un hilo de Codex', () => {
  it('reabrir_hiloConOriginalYSegmentos_soloLosTurnosDeLaRpc', async () => {
    const home = tempHome();
    seedThread(home, true);
    const source = codexTranscriptSource(new CodexHistoryService(fsDeps, vi.fn()), home, THREAD);
    const listTurns = vi.fn(async () => VIGENTES);

    const batches = await collect(codexTurnsBatches(() => listTurns()));

    expect(source?.kind).toBe('codexTurns');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.entries).toHaveLength(2);
    const text = JSON.stringify(batches[0]?.entries);
    expect(text).not.toContain('Lista los ficheros');
    expect(text).toContain('Turno vigente');
  });

  it('reabrir_hiloSinSegmentos_leeElRollout', () => {
    const home = tempHome();
    seedThread(home, false);

    const source = codexTranscriptSource(new CodexHistoryService(fsDeps, vi.fn()), home, THREAD);

    expect(source?.kind).toBe('file');
    expect(source?.kind === 'file' && source.filePath.endsWith(`${THREAD}.jsonl`)).toBe(true);
  });
});
