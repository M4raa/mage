import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgyStep, AgyStore } from './agyHistory';
import { AGY_DB_SCHEMA, type AgyDbContent } from './nativeWriters';

// Lectura real de las bases de agy: SQLite en SOLO LECTURA (agy puede tener la conversación abierta; nunca se
// escribe en ella). Cada consulta abre y cierra: el historial se sondea poco y no se retienen manejadores.

interface StepRow {
  readonly idx: number;
  readonly step_type: number;
  readonly step_payload: Uint8Array | null;
}

function toStep(row: StepRow): AgyStep {
  return { index: row.idx, stepType: row.step_type, payload: row.step_payload ?? new Uint8Array() };
}

function withDb<T>(dbPath: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

export function createAgySqliteStore(): AgyStore {
  return {
    exists: existsSync,
    listDir: (path) => readdirSync(path),
    stat: (path) => {
      const stat = statSync(path);
      return { mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    },
    readSteps: (dbPath) => withDb(dbPath, (db) => (db.prepare('SELECT idx, step_type, step_payload FROM steps ORDER BY idx').all() as unknown as StepRow[]).map(toStep)),
    readFirstUserStep: (dbPath) =>
      withDb(dbPath, (db) => {
        const row = db.prepare('SELECT idx, step_type, step_payload FROM steps WHERE step_type = 14 ORDER BY idx LIMIT 1').get() as unknown as StepRow | undefined;
        return row === undefined ? null : toStep(row);
      }),
  };
}

// agy 1.3.1 reanuda una base escrita así (medido con `spike/agy-resume-synth-spike.mjs --mode minimal`).
const AGY_TRAJECTORY_TYPE = 4;
const AGY_SOURCE = 17;
const AGY_STEP_DONE = 3;

export function writeAgyConversationDb(dbPath: string, content: AgyDbContent): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN');
    for (const statement of AGY_DB_SCHEMA) db.exec(statement);
    db.prepare('INSERT INTO trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) VALUES (?, ?, ?, ?)').run(content.trajectoryId, content.conversationId, AGY_TRAJECTORY_TYPE, AGY_SOURCE);
    db.prepare('INSERT INTO trajectory_metadata_blob (id, data) VALUES (?, ?)').run('main', content.metadataBlob);
    const insert = db.prepare('INSERT INTO steps (idx, step_type, status, has_subtrajectory, metadata, step_payload, step_format) VALUES (?, ?, ?, 0, ?, ?, 0)');
    for (const step of content.steps) insert.run(step.idx, step.stepType, AGY_STEP_DONE, step.metadata, step.payload);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}
