import { join } from 'node:path';
import type { MentionCandidate, MentionSearchParams, MentionSearchResult } from '@shared/mentions';
import { classifyMention, SNIFF_BYTES } from './mentionKind';
import { rankPaths } from './rankPaths';

export const INDEX_TTL_MS = 30_000;
export const MAX_INDEXED_FILES = 50_000;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export interface FileIndexDeps {
  // Ficheros versionados y no ignorados (rutas relativas con `/`); null = no es repo o git fallo.
  readonly listGitFiles: (cwd: string) => Promise<readonly string[] | null>;
  readonly walk: (cwd: string, maxFiles: number) => Promise<readonly string[]>;
  readonly isTrusted: (cwd: string, accountDir: string) => boolean;
  readonly stat: (absPath: string) => Promise<{ readonly bytes: number } | null>;
  readonly readHead: (absPath: string, bytes: number) => Promise<Uint8Array | null>;
  readonly now: () => number;
}

interface CachedList {
  readonly at: number;
  readonly files: Promise<{ readonly files: readonly string[]; readonly truncated: boolean }>;
}

// Indice de los ficheros de una carpeta para las menciones @. La lista se cachea por carpeta un rato
// (listar un repo grande no es gratis); la clase y el tamano se miden solo para los pocos resultados.
export class FileIndexService {
  private readonly cache = new Map<string, CachedList>();

  constructor(private readonly deps: FileIndexDeps) {}

  async search(params: MentionSearchParams): Promise<MentionSearchResult> {
    if (!Number.isInteger(params.limit) || params.limit < MIN_LIMIT || params.limit > MAX_LIMIT) {
      throw new Error(`limit de menciones invalido (entero ${MIN_LIMIT}..${MAX_LIMIT}): ${JSON.stringify(params.limit)}`);
    }
    if (typeof params.query !== 'string') throw new Error(`query de menciones invalida: ${JSON.stringify(params.query)}`);
    if (!this.deps.isTrusted(params.cwd, params.accountDir)) return { candidates: [], truncated: false, reason: 'untrusted' };
    const { files, truncated } = await this.listFiles(params.cwd);
    const ranked = rankPaths(files, params.query, params.limit);
    const measured = await Promise.all(ranked.map((relPath) => this.measure(params.cwd, relPath)));
    return { candidates: measured.filter((candidate): candidate is MentionCandidate => candidate !== null), truncated, reason: 'ok' };
  }

  private listFiles(cwd: string): CachedList['files'] {
    const cached = this.cache.get(cwd);
    if (cached !== undefined && this.deps.now() - cached.at < INDEX_TTL_MS) return cached.files;
    const files = this.loadList(cwd);
    this.cache.set(cwd, { at: this.deps.now(), files });
    // Un fallo no se cachea: la siguiente busqueda lo reintenta.
    files.catch(() => this.cache.delete(cwd));
    return files;
  }

  private async loadList(cwd: string): Promise<{ files: readonly string[]; truncated: boolean }> {
    const fromGit = await this.deps.listGitFiles(cwd);
    const all = fromGit ?? (await this.deps.walk(cwd, MAX_INDEXED_FILES));
    return { files: all.slice(0, MAX_INDEXED_FILES), truncated: all.length >= MAX_INDEXED_FILES };
  }

  private async measure(cwd: string, relPath: string): Promise<MentionCandidate | null> {
    const absPath = join(cwd, relPath);
    const stat = await this.deps.stat(absPath);
    if (stat === null) return null;
    const head = await this.deps.readHead(absPath, SNIFF_BYTES);
    if (head === null) return null;
    return { relPath, absPath, kind: classifyMention(relPath, head).kind, bytes: stat.bytes };
  }
}
