import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgyHistoryService } from './agyHistory';
import { createAgySqliteStore, writeAgyConversationDb } from './agySqliteStore';
import { CodexHistoryService } from './codexHistory';
import { ConversationMigrationService } from './conversationMigration';
import { createMigrationEndpoints } from './migrationEndpoints';
import { agyDbContent, claudeTranscriptText } from './nativeWriters';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';

// Migración de punta a punta sobre ficheros y bases SQLite REALES en una carpeta temporal: solo el CLI de Codex
// (`thread/delete`) es falso. Los CLI de verdad se comprueban con los spikes (`spike/*-spike.mjs`).

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ROLLOUT = join(__dirname, '..', '..', 'shared', 'fixtures', 'codex-rollout.jsonl');
const THREAD = '11111111-2222-3333-4444-555555555555';
const CWD = 'C:\\proyecto';

function world() {
  const root = mkdtempSync(join(tmpdir(), 'mage-migrate-'));
  roots.push(root);
  const dirs = { claudeA: join(root, '.claude-a'), claudeB: join(root, '.claude-b'), codexA: join(root, '.codex-a'), codexB: join(root, '.codex-b'), agyA: join(root, 'agy-a'), agyB: join(root, 'agy-b'), agyReal: join(root, 'agy-real') };
  let counter = 0;
  const fsDeps = {
    exists: existsSync,
    listDir: (path: string) => readdirSync(path),
    isDirectory: (path: string) => statSync(path).isDirectory(),
    statFile: (path: string) => ({ mtimeMs: statSync(path).mtimeMs, sizeBytes: statSync(path).size }),
    readPrefix: (path: string, max: number) => readFileSync(path, 'utf8').slice(0, max),
    readSuffix: (path: string, max: number) => readFileSync(path, 'utf8').slice(-max),
  };
  const codexHistory = new CodexHistoryService(fsDeps);
  const agyHistory = new AgyHistoryService(createAgySqliteStore());
  const deleted: string[] = [];
  const endpoints = createMigrationEndpoints({
    readText: (path) => readFileSync(path, 'utf8'),
    writeText: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); },
    copyFile: (from, to) => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); },
    removeFile: (path) => rmSync(path, { force: true }),
    nowMs: () => Date.parse('2026-10-07T10:00:00Z'),
    newId: () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, '0')}`,
    claude: { effectiveDir: (dir) => dir, deleteConversation: (ref) => { deleted.push(ref.sessionId); rmSync(resolveTranscriptPath(ref.accountDir, ref.cwd, ref.sessionId), { force: true }); } },
    codex: { homeOf: (dir) => dir, history: codexHistory, deleteThread: async (home, id) => { deleted.push(id); const path = codexHistory.findRollout(home, id); if (path !== null) rmSync(path); } },
    agy: { profileOf: (dir) => dir, externalOf: (dir) => (dir === dirs.agyA ? [dirs.agyReal] : []), history: agyHistory, writeDb: writeAgyConversationDb },
  });
  return { dirs, service: new ConversationMigrationService(endpoints), codexHistory, agyHistory, deleted, endpoints };
}

function seedCodex(home: string): void {
  const day = join(home, 'sessions', '2026', '10', '05');
  mkdirSync(day, { recursive: true });
  copyFileSync(ROLLOUT, join(day, `rollout-2026-10-05T08-00-00-${THREAD}.jsonl`));
}

describe('migración de punta a punta', () => {
  it('codexAClaude_escribeLaTranscripcionNativaYRetiraElHilo', async () => {
    const w = world();
    seedCodex(w.dirs.codexA);

    const result = await w.service.migrate({ sourceAccountDir: w.dirs.codexA, sourceProvider: 'codex', sessionId: THREAD, cwd: CWD, privacy: 'shared', destAccountDir: w.dirs.claudeB, destProvider: 'claude' });

    const file = resolveTranscriptPath(w.dirs.claudeB, CWD, result.sessionId);
    expect(existsSync(file)).toBe(true);
    const back = w.endpoints.claude.source.read({ accountDir: w.dirs.claudeB, sessionId: result.sessionId, cwd: CWD, privacy: 'shared' });
    expect(back.items.map((i) => i.kind)).toEqual(['user', 'tool', 'tool', 'assistant']);
    expect(w.codexHistory.findRollout(w.dirs.codexA, THREAD)).toBeNull();
    expect(w.deleted).toContain(THREAD);
  });

  it('claudeAAgy_escribeLaBaseYQuitaLaTranscripcionDeOrigen', async () => {
    const w = world();
    const sessionId = 'claude-origen-1';
    const source = resolveTranscriptPath(w.dirs.claudeA, CWD, sessionId);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, claudeTranscriptText({ cwd: CWD, title: 't', items: [{ kind: 'user', text: 'hola agy', atMs: null }, { kind: 'assistant', text: 'hola', atMs: null }] }, { sessionId, newId: () => `u-${Math.random()}`, clock: { baseMs: 0 } }));

    const result = await w.service.migrate({ sourceAccountDir: w.dirs.claudeA, sourceProvider: 'claude', sessionId, cwd: CWD, privacy: 'shared', destAccountDir: w.dirs.agyB, destProvider: 'agy' });

    expect(w.agyHistory.findDb(w.dirs.agyB, result.sessionId)).not.toBeNull();
    expect(w.agyHistory.list(w.dirs.agyB, w.dirs.agyB)[0]).toMatchObject({ title: 'hola agy', providerId: 'agy' });
    expect(existsSync(source)).toBe(false);
  });

  it('agyACodex_laConversacionDeAgySeEscribeComoRolloutYSeRetiraDeAgy', async () => {
    const w = world();
    const sessionId = 'aaaaaaaa-0000-4000-8000-000000000001';
    w.endpoints.agy.sink.write({ cwd: CWD, title: 't', items: [{ kind: 'user', text: 'pregunta', atMs: null }, { kind: 'assistant', text: 'respuesta', atMs: null }] }, { accountDir: w.dirs.agyA, privacy: 'shared' });
    const [created] = w.agyHistory.list(w.dirs.agyA, w.dirs.agyA);

    const result = await w.service.migrate({ sourceAccountDir: w.dirs.agyA, sourceProvider: 'agy', sessionId: created!.sessionId, cwd: CWD, privacy: 'shared', destAccountDir: w.dirs.codexB, destProvider: 'codex' });

    expect(sessionId).toBeTruthy();
    expect(w.codexHistory.list(w.dirs.codexB)[0]).toMatchObject({ sessionId: result.sessionId, title: 'pregunta' });
    expect(w.agyHistory.findDb(w.dirs.agyA, created!.sessionId)).toBeNull();
  });

  it('codexACodex_copiaElRolloutSinPerdidaConElMismoIdYRetiraElOrigen', async () => {
    const w = world();
    seedCodex(w.dirs.codexA);

    const result = await w.service.migrate({ sourceAccountDir: w.dirs.codexA, sourceProvider: 'codex', sessionId: THREAD, cwd: CWD, privacy: 'shared', destAccountDir: w.dirs.codexB, destProvider: 'codex' });

    expect(result.sessionId).toBe(THREAD);
    const copied = w.codexHistory.findRollout(w.dirs.codexB, THREAD);
    expect(copied).not.toBeNull();
    expect(readFileSync(copied!, 'utf8')).toBe(readFileSync(ROLLOUT, 'utf8'));
    expect(w.codexHistory.findRollout(w.dirs.codexA, THREAD)).toBeNull();
  });

  it('codexACodex_elDestinoYaTieneLaConversacion_lanzaYNoTocaElOrigen', async () => {
    const w = world();
    seedCodex(w.dirs.codexA);
    seedCodex(w.dirs.codexB);

    await expect(w.service.migrate({ sourceAccountDir: w.dirs.codexA, sourceProvider: 'codex', sessionId: THREAD, cwd: CWD, privacy: 'shared', destAccountDir: w.dirs.codexB, destProvider: 'codex' }))
      .rejects.toThrow('ya tiene la conversacion');

    expect(w.codexHistory.findRollout(w.dirs.codexA, THREAD)).not.toBeNull();
  });

  it('agyDelPerfilRealDelUsuario_seMigraPeroSuBaseNoSeBorra', async () => {
    const w = world();
    const id = 'bbbbbbbb-0000-4000-8000-000000000002';
    const content = agyDbContent({ cwd: CWD, title: 't', items: [{ kind: 'user', text: 'del cli real', atMs: null }, { kind: 'assistant', text: 'ok', atMs: null }] },
      { conversationId: id, trajectoryId: 'traj', newId: () => 'step-id', clock: { baseMs: 0 } });
    writeAgyConversationDb(join(w.dirs.agyReal, '.gemini', 'antigravity-cli', 'conversations', `${id}.db`), content);

    const result = await w.service.migrate({ sourceAccountDir: w.dirs.agyA, sourceProvider: 'agy', sessionId: id, cwd: CWD, privacy: 'shared', destAccountDir: w.dirs.codexB, destProvider: 'codex' });

    expect(w.codexHistory.list(w.dirs.codexB)[0]).toMatchObject({ sessionId: result.sessionId, title: 'del cli real' });
    expect(w.agyHistory.findDb(w.dirs.agyReal, id)).not.toBeNull();
  });
});
