import { join } from 'node:path';
import type { ConversationSummary } from '@shared/conversations';
import { readCodexRolloutHead, type CodexRolloutHead } from '@shared/codexTranscript';
import type { ConversationsDeps } from './conversationsService';

// Historial de una cuenta de Codex: los rollouts de `<CODEX_HOME>/sessions/AAAA/MM/DD/rollout-<fecha>-<id>.jsonl`
// (medido con codex-cli 0.160.0). Mismo patrón que `ConversationsService`: solo FS con DI, lectura tolerante
// por fichero y cache por ruta+mtime+tamaño, porque el historial se sondea cada pocos segundos.

const SESSIONS_DIR = 'sessions';
const ROLLOUT_PREFIX = 'rollout-';
const ROLLOUT_EXT = '.jsonl';
// El `session_meta` lleva las instrucciones base enteras (decenas de KB): hace falta más cabeza que en Claude
// para llegar al primer mensaje del usuario.
const HEAD_BYTES = 256 * 1024;
const MAX_CONVERSATIONS = 300;
// Cola que se lee para el instante de la última línea (H4, devolución 18). Si no cabe ninguna línea entera, se
// amplía ×4 hasta el tope; más allá, el mtime. Las líneas de Codex son casi siempre de pocos KB.
const TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const TAIL_GROWTH = 4;
// ISO 8601 completo, como lo escribe Codex («2026-10-26T12:43:35.654Z»): `Date.parse` sola acepta demasiado.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Lo leído de un rollout, válido mientras no cambien su mtime ni su tamaño (el tamaño SÍ cambia al escribir).
interface CachedRollout {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly head: CodexRolloutHead | null;
  readonly lastLineMs: number | null;
}

// Instante de una línea del rollout validado en la frontera, o null si la línea no es JSON (truncada a medio
// escribir) o su `timestamp` no es un ISO real. Que una línea no valga es un caso esperado: se mira la anterior.
export function rolloutLineTimestampMs(line: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const timestamp = typeof parsed === 'object' && parsed !== null ? (parsed as { timestamp?: unknown }).timestamp : undefined;
  if (typeof timestamp !== 'string' || !ISO_TIMESTAMP.test(timestamp)) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

// La última línea con instante válido, recorriendo desde el final.
function lastTimestampMs(lines: readonly string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const ms = line.trim().length === 0 ? null : rolloutLineTimestampMs(line);
    if (ms !== null) return ms;
  }
  return null;
}

export class CodexHistoryService {
  private readonly cache = new Map<string, CachedRollout>();

  constructor(private readonly deps: ConversationsDeps) {}

  list(home: string): ConversationSummary[] {
    if (home.trim().length === 0) throw new Error(`CODEX_HOME vacio al listar conversaciones: ${JSON.stringify(home)}`);
    const summaries: ConversationSummary[] = [];
    for (const path of this.rolloutPaths(home)) {
      const summary = this.describe(path, home);
      if (summary !== null) summaries.push(summary);
    }
    summaries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return summaries.slice(0, MAX_CONVERSATIONS);
  }

  // Ruta del rollout de una conversación, o null. El id se valida: nunca llega un segmento de ruta del renderer.
  findRollout(home: string, sessionId: string): string | null {
    if (!/^[A-Za-z0-9-]+$/.test(sessionId)) throw new Error(`sessionId de Codex no valido: ${JSON.stringify(sessionId)}`);
    const suffix = `-${sessionId}${ROLLOUT_EXT}`;
    return this.rolloutPaths(home).find((path) => path.endsWith(suffix)) ?? null;
  }

  private rolloutPaths(home: string): string[] {
    const root = join(home, SESSIONS_DIR);
    if (!this.deps.exists(root)) return [];
    const paths: string[] = [];
    for (const year of this.dirs(root)) {
      for (const month of this.dirs(join(root, year))) {
        for (const day of this.dirs(join(root, year, month))) {
          const dir = join(root, year, month, day);
          for (const file of this.deps.listDir(dir)) {
            if (file.startsWith(ROLLOUT_PREFIX) && file.endsWith(ROLLOUT_EXT)) paths.push(join(dir, file));
          }
        }
      }
    }
    return paths;
  }

  private dirs(parent: string): string[] {
    return this.deps.listDir(parent).filter((name) => this.deps.isDirectory(join(parent, name)));
  }

  // null si el fichero desaparece, es ilegible o no tiene ningún mensaje real del usuario.
  private describe(path: string, home: string): ConversationSummary | null {
    try {
      const stat = this.deps.statFile(path);
      const rollout = this.read(path, stat);
      const head = rollout.head;
      if (head === null || head.title.length === 0) return null;
      return {
        sessionId: head.sessionId,
        configDir: home,
        cwd: head.cwd,
        title: head.title,
        privacy: 'shared',
        // Codex no mueve el mtime al escribir (H4, medido): manda la última línea si es posterior.
        updatedAtMs: Math.max(stat.mtimeMs, rollout.lastLineMs ?? stat.mtimeMs),
        sizeBytes: stat.sizeBytes,
        isScheduled: false,
        providerId: 'codex',
      };
    } catch {
      return null;
    }
  }

  private read(path: string, stat: { readonly mtimeMs: number; readonly sizeBytes: number }): CachedRollout {
    const cached = this.cache.get(path);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.sizeBytes) return cached;
    const head = readCodexRolloutHead(this.deps.readPrefix(path, HEAD_BYTES).split(/\r?\n/));
    // Sin título no sale en el historial: no hace falta su cola.
    const lastLineMs = head === null || head.title.length === 0 ? null : this.lastLineMs(path, stat.sizeBytes);
    const entry: CachedRollout = { mtimeMs: stat.mtimeMs, sizeBytes: stat.sizeBytes, head, lastLineMs };
    this.cache.set(path, entry);
    return entry;
  }

  // Lectura ACOTADA de la cola: los últimos KB, ampliando solo si ninguna línea entera cabe. La primera línea de
  // una ventana que no empieza en el byte 0 está cortada (y puede traer UTF-8 partido): no cuenta.
  private lastLineMs(path: string, sizeBytes: number): number | null {
    let window = Math.min(TAIL_BYTES, sizeBytes);
    while (window > 0) {
      const lines = this.deps.readSuffix(path, window).split(/\r?\n/);
      const found = lastTimestampMs(window < sizeBytes ? lines.slice(1) : lines);
      if (found !== null || window >= sizeBytes || window >= MAX_TAIL_BYTES) return found;
      window = Math.min(window * TAIL_GROWTH, sizeBytes, MAX_TAIL_BYTES);
    }
    return null;
  }
}
