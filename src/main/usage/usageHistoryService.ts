import type { DayDetail, DayKey, UsageHistory } from '@shared/usageHistory';
import { aggregateHistory, INITIAL_PARSE_STATE, localDayKey, localTimeOf, mergeDayMaps, parseUsageLines, pruneWindowPeaks, recordWindowPeak, type FileUsage, type ParseState, type WindowPeaks } from './usageHistory';

// Servicio de «Cuentas y consumo» (P-038 V11): consumo por días leyendo las transcripciones de Claude y foto diaria de
// las ventanas de la suscripción. MEDIDO en la máquina del usuario: 615 transcripciones y 850 MB solo del último mes,
// así que nada de releer: las transcripciones solo CRECEN por el final, y por fichero se guarda hasta qué byte se leyó
// y lo que sumaba. Al abrir la pantalla solo se lee lo nuevo. La primera pasada es la única cara.

export const HISTORY_DAYS = 30;
// Lo que se guarda en la caché: un poco más que lo que se enseña, para no releer al cambiar de día.
const KEEP_DAYS = 40;
// Trozo de lectura: acota la memoria con transcripciones de cientos de MB.
const CHUNK_BYTES = 8 * 1024 * 1024;
const MS_PER_DAY = 86_400_000;
const NEWLINE = 0x0a;

export interface TranscriptRoot {
  readonly dir: string; // un `projects/`
  readonly ownerAccountId?: string; // perfil privado: sus conversaciones son de su cuenta
}

export interface TranscriptFile {
  readonly path: string;
  readonly sessionId: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

export interface CachedFile {
  readonly offset: number;
  readonly sessionId: string;
  readonly ownerAccountId?: string;
  readonly state: ParseState;
  readonly days: Readonly<Record<DayKey, DayDetail>>;
}

// Versión 2 (P-039): el día guarda el detalle por modelo, topes, horas y herramientas. Una caché v1 no casa con el
// esquema y se reconstruye releyendo las transcripciones (una vez).
export const USAGE_HISTORY_CACHE_VERSION = 2;

export interface UsageHistoryCache {
  readonly version: typeof USAGE_HISTORY_CACHE_VERSION;
  readonly files: Readonly<Record<string, CachedFile>>;
  readonly windows: Readonly<Record<string, Readonly<Record<DayKey, WindowPeaks>>>>;
}

export const EMPTY_CACHE: UsageHistoryCache = { version: USAGE_HISTORY_CACHE_VERSION, files: {}, windows: {} };

export interface UsageHistoryDeps {
  readonly roots: () => readonly TranscriptRoot[];
  readonly listTranscripts: (root: string) => Promise<readonly TranscriptFile[]>;
  // Bytes [start, end) del fichero.
  readonly readRange: (path: string, start: number, end: number) => Promise<Buffer>;
  readonly loadCache: () => UsageHistoryCache;
  readonly saveCache: (cache: UsageHistoryCache) => void;
  readonly accountIds: () => readonly string[];
  readonly accountOf: (sessionId: string) => string | undefined;
  readonly now: () => number;
  readonly offsetMinutes: () => number;
  readonly log: (level: 'info' | 'warn', message: string, data?: unknown) => void;
}

export class UsageHistoryService {
  private cache: UsageHistoryCache | null = null;
  private running: Promise<UsageHistory> | null = null;

  constructor(private readonly deps: UsageHistoryDeps) {}

  // Una sola pasada a la vez: dos aperturas seguidas de la pantalla comparten la misma.
  history(): Promise<UsageHistory> {
    this.running ??= this.build().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  // Foto de las ventanas 5 h / 7 d de una cuenta (lo más alto del día). La lectura viene del endpoint o del stream.
  recordWindows(accountId: string, reading: WindowPeaks): void {
    if (accountId.trim().length === 0) throw new Error(`accountId vacio al guardar las ventanas: ${JSON.stringify(accountId)}`);
    const cache = this.current();
    const day = this.dayOf(this.deps.now());
    const peaks = pruneWindowPeaks(recordWindowPeak(cache.windows[accountId], day, reading), this.fromDay(KEEP_DAYS));
    this.save({ ...cache, windows: { ...cache.windows, [accountId]: peaks } });
  }

  private async build(): Promise<UsageHistory> {
    const keepFrom = this.fromDay(KEEP_DAYS);
    const minMtime = this.deps.now() - KEEP_DAYS * MS_PER_DAY;
    const previous = this.current().files;
    const files: Record<string, CachedFile> = {};
    let invalid = 0;
    for (const root of this.deps.roots()) {
      for (const file of await this.deps.listTranscripts(root.dir)) {
        if (file.mtimeMs < minMtime) continue; // nada de ese fichero entra en la ventana
        const updated = await this.updateFile(file, root, previous[file.path]);
        invalid += updated.invalid;
        files[file.path] = { ...updated.entry, days: pruneDays(updated.entry.days, keepFrom) };
      }
    }
    if (invalid > 0) this.deps.log('warn', 'Líneas de transcripción ilegibles al calcular el consumo', { lineas: invalid });
    this.save({ ...this.current(), files });
    return this.aggregate(files);
  }

  // Lee solo lo que el fichero creció desde la última vez. Si encogió (se reescribió), desde el principio.
  private async updateFile(file: TranscriptFile, root: TranscriptRoot, cached: CachedFile | undefined): Promise<{ entry: CachedFile; invalid: number }> {
    const fresh = cached === undefined || file.sizeBytes < cached.offset;
    let entry: CachedFile = fresh
      ? { offset: 0, sessionId: file.sessionId, ...(root.ownerAccountId === undefined ? {} : { ownerAccountId: root.ownerAccountId }), state: INITIAL_PARSE_STATE, days: {} }
      : cached;
    let invalid = 0;
    while (entry.offset < file.sizeBytes) {
      const end = Math.min(file.sizeBytes, entry.offset + CHUNK_BYTES);
      const bytes = await this.deps.readRange(file.path, entry.offset, end);
      const lastNewline = bytes.lastIndexOf(NEWLINE);
      if (lastNewline < 0) break; // una línea a medio escribir (o más larga que el trozo): se lee la próxima vez
      const parsed = parseUsageLines(bytes.subarray(0, lastNewline).toString('utf8').split('\n'), entry.state, (ms) => localTimeOf(ms, this.deps.offsetMinutes()));
      invalid += parsed.invalidLines;
      entry = { ...entry, offset: entry.offset + lastNewline + 1, state: parsed.state, days: mergeDayMaps(entry.days, parsed.days) };
    }
    return { entry, invalid };
  }

  private aggregate(files: Readonly<Record<string, CachedFile>>): UsageHistory {
    const list: FileUsage[] = Object.values(files).map((file) => ({
      sessionId: file.sessionId,
      days: file.days,
      ...(file.ownerAccountId === undefined ? {} : { ownerAccountId: file.ownerAccountId }),
      ...(file.state.cwd === undefined ? {} : { cwd: file.state.cwd }),
    }));
    return aggregateHistory({
      files: list,
      accountIds: this.deps.accountIds(),
      accountOf: this.deps.accountOf,
      windows: this.current().windows,
      fromDay: this.fromDay(HISTORY_DAYS),
      generatedAt: this.deps.now(),
    });
  }

  private current(): UsageHistoryCache {
    this.cache ??= this.deps.loadCache();
    return this.cache;
  }

  private save(cache: UsageHistoryCache): void {
    this.cache = cache;
    this.deps.saveCache(cache);
  }

  private dayOf(ms: number): DayKey {
    return localDayKey(ms, this.deps.offsetMinutes());
  }

  // Primer día incluido de una ventana de `days` días que acaba hoy.
  private fromDay(days: number): DayKey {
    return this.dayOf(this.deps.now() - (days - 1) * MS_PER_DAY);
  }
}

function pruneDays(days: Readonly<Record<DayKey, DayDetail>>, fromDay: DayKey): Record<DayKey, DayDetail> {
  return Object.fromEntries(Object.entries(days).filter(([day]) => day >= fromDay));
}
