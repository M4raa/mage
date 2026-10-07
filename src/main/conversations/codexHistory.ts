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

interface CachedHead {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly head: CodexRolloutHead | null;
}

export class CodexHistoryService {
  private readonly cache = new Map<string, CachedHead>();

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
      const head = this.headOf(path, stat);
      if (head === null || head.title.length === 0) return null;
      return {
        sessionId: head.sessionId,
        configDir: home,
        cwd: head.cwd,
        title: head.title,
        privacy: 'shared',
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.sizeBytes,
        isScheduled: false,
        providerId: 'codex',
      };
    } catch {
      return null;
    }
  }

  private headOf(path: string, stat: { readonly mtimeMs: number; readonly sizeBytes: number }): CodexRolloutHead | null {
    const cached = this.cache.get(path);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.sizeBytes) return cached.head;
    const head = readCodexRolloutHead(this.deps.readPrefix(path, HEAD_BYTES).split(/\r?\n/));
    this.cache.set(path, { mtimeMs: stat.mtimeMs, sizeBytes: stat.sizeBytes, head });
    return head;
  }
}
