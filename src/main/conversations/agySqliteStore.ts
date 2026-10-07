import { existsSync, readdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AgyStep, AgyStore } from './agyHistory';

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
