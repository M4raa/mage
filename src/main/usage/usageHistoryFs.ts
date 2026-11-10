import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { HOURS_PER_DAY } from '@shared/usageHistory';
import { EMPTY_CACHE, USAGE_HISTORY_CACHE_VERSION, type TranscriptFile, type TranscriptFormat, type UsageHistoryCache } from './usageHistoryService';

// El disco de «Cuentas y consumo» (P-038 V11): listar transcripciones, leer un rango de bytes y validar la caché. Todo
// asíncrono: la primera pasada lee cientos de MB y no puede parar el hilo de main.

const JSONL = '.jsonl';
const SUBAGENTS_DIR = 'subagents';

// Los registros de una raíz según su formato.
export function listTranscriptsOf(dir: string, format: TranscriptFormat): Promise<readonly TranscriptFile[]> {
  if (format === 'codex') return listCodexRollouts(dir);
  return format === 'agy' ? listAgyConversations(dir) : listTranscripts(dir);
}

const AGY_DB = '.db';
const WAL_SUFFIX = '-wal';

// `<perfil>/.gemini/antigravity-cli/conversations/<id>.db` (P-039 F3). Tamaño y fecha juntan la base y su -wal: agy
// escribe en modo WAL y la base no cambia hasta el checkpoint.
export async function listAgyConversations(dir: string): Promise<readonly TranscriptFile[]> {
  const result: TranscriptFile[] = [];
  for (const entry of await readDirOrEmpty(dir)) {
    if (!entry.endsWith(AGY_DB)) continue;
    const db = await describe(join(dir, entry), basename(entry, AGY_DB));
    if (db === null) continue;
    const wal = await describe(join(dir, `${entry}${WAL_SUFFIX}`), db.sessionId);
    result.push(wal === null ? db : { ...db, sizeBytes: db.sizeBytes + wal.sizeBytes, mtimeMs: Math.max(db.mtimeMs, wal.mtimeMs) });
  }
  return result;
}

const CODEX_ROLLOUT = /^rollout-.*\.jsonl$/;
// Profundidad de `sessions/AAAA/MM/DD/`: no se baja más (ni se sigue nada raro que haya debajo).
const CODEX_DATE_DEPTH = 3;

// `<CODEX_HOME>/sessions/AAAA/MM/DD/rollout-<fecha>-<id>.jsonl` (P-039 F2). Cada registro es una conversación.
export async function listCodexRollouts(sessionsDir: string, depth = 0): Promise<readonly TranscriptFile[]> {
  const result: TranscriptFile[] = [];
  for (const entry of await readDirOrEmpty(sessionsDir)) {
    const path = join(sessionsDir, entry);
    if (depth === CODEX_DATE_DEPTH) {
      if (!CODEX_ROLLOUT.test(entry)) continue;
      const file = await describe(path, basename(entry, JSONL));
      if (file !== null) result.push(file);
      continue;
    }
    result.push(...(await listCodexRollouts(path, depth + 1)));
  }
  return result;
}

// `<proyecto>/<sesión>.jsonl` y los de sus subagentes `<proyecto>/<sesión>/subagents/*.jsonl` (cuentan para su sesión).
export async function listTranscripts(projectsDir: string): Promise<readonly TranscriptFile[]> {
  const result: TranscriptFile[] = [];
  for (const project of await readDirOrEmpty(projectsDir)) {
    const projectDir = join(projectsDir, project);
    for (const entry of await readDirOrEmpty(projectDir)) {
      const path = join(projectDir, entry);
      if (entry.endsWith(JSONL)) {
        const file = await describe(path, basename(entry, JSONL));
        if (file !== null) result.push(file);
        continue;
      }
      for (const sub of await readDirOrEmpty(join(path, SUBAGENTS_DIR))) {
        if (!sub.endsWith(JSONL)) continue;
        const file = await describe(join(path, SUBAGENTS_DIR, sub), entry);
        if (file !== null) result.push(file);
      }
    }
  }
  return result;
}

// Una carpeta que no existe (o un fichero en su lugar) no tiene transcripciones; cualquier otro fallo se propaga.
async function readDirOrEmpty(dir: string): Promise<readonly string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }
}

// null si desapareció entre el listado y el stat (el CLI puede estar escribiéndola o borrándola).
async function describe(path: string, sessionId: string): Promise<TranscriptFile | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { path, sessionId, sizeBytes: info.size, mtimeMs: info.mtimeMs } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) throw new Error(`Rango no valido para ${path}: ${start}..${end}`);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const count = z.number().int().min(0);
const pct = z.number().min(0).max(100).nullable();
const modelUsage = z.object({ inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWrite5mTokens: count, cacheWrite1hTokens: count, turns: count });
const dayDetail = z.object({
  byModel: z.record(modelUsage),
  limits: z.object({ fiveHour: count, weekly: count, other: count }),
  hours: z.array(count).length(HOURS_PER_DAY),
  tools: z.record(count),
  peaks: z.object({ fiveHourMax: pct, sevenDayMax: pct }).optional(),
});
const CacheSchema = z.object({
  version: z.literal(USAGE_HISTORY_CACHE_VERSION),
  files: z.record(z.object({
    offset: count,
    mtimeMs: z.number().optional(),
    sessionId: z.string().min(1),
    ownerAccountId: z.string().min(1).optional(),
    state: z.object({ recentIds: z.array(z.string()), cwd: z.string().optional(), model: z.string().optional(), atLimit: z.boolean().optional() }),
    days: z.record(dayDetail),
  })),
  windows: z.record(z.record(z.object({ fiveHourMax: pct, sevenDayMax: pct }))),
});

// La caché es nuestra: si no casa (versión vieja, fichero roto), se empieza de cero y se dice. No es un dato del
// usuario: se reconstruye leyendo las transcripciones.
export function parseUsageHistoryCache(text: string | null, warn: (message: string, data?: unknown) => void): UsageHistoryCache {
  if (text === null) return EMPTY_CACHE;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    warn('Caché de consumo ilegible: se reconstruye', { error: error instanceof Error ? error.message : String(error) });
    return EMPTY_CACHE;
  }
  const parsed = CacheSchema.safeParse(raw);
  if (!parsed.success) {
    warn('Caché de consumo con otra forma: se reconstruye', { issues: parsed.error.issues.length });
    return EMPTY_CACHE;
  }
  return parsed.data;
}
