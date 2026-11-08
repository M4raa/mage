// Spike de F4.6 (carril K, punto de control K10): keep-alive de la caché de Claude con el coordinador REAL de Mage y Claude REAL
// (haiku/low, la cuenta de ~/.claude con su suscripción). Reutiliza el montaje de `rewind-claude-entry.ts` (mismo coordinador,
// RewindStateStore y adapter) sin servidor falso: gasta cuota. Lo empaqueta y lo lanza `keepalive-claude.mjs`.
// No copia credenciales a ningún sitio: el config dir de la cuenta ES ~/.claude. La salida solo lleva recuentos, ratios y booleanos.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_KEEP_ALIVE } from '@shared/settings';
import { attempt, CLAUDE_MOUNT, Rig, rm, sleep, type Live, type Rec } from './rewind-claude-entry';

const MS_PER_MINUTE = 60_000;
const SERIES_PREFIX = 'mage-k-ka-';
const KA_OFFSET_MS = 3_600_000; // se «salta» una hora para que el keep-alive de la serie corta venza ya
const TIMER_WAIT_MS = 60_000;
const KA_DONE_WAIT_MS = 180_000;
const LONG_KA_WAIT_MS = 65 * MS_PER_MINUTE;
const LONG_CHECK_AT_MS = 70 * MS_PER_MINUTE;
// Un nombre de carpeta de proyecto de Claude: cada carácter no alfanumérico pasa a «-» (como `projectDir()` de claude-lib.mjs).
const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;

export interface KeepAliveOptions {
  readonly long: boolean;
  readonly bigChars: number;
}

interface Usage { readonly cacheRead: number | null; readonly cacheCreation: number | null; readonly input: number | null; readonly output: number | null; readonly ttlSeconds: number | null }

// Líneas numeradas fabricadas, como a1.mjs: un mensaje enorme y poco comprimible.
function bigText(targetChars: number): string {
  const lines: string[] = [];
  let size = 0;
  for (let n = 0; size < targetChars; n += 1) {
    const line = `linea ${String(n).padStart(6, '0')} clave ${((n * 2654435761) % 4294967296).toString(16)} marca ${((n * 40503) % 65521).toString(36)}`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join('\n');
}

function usageOfLast(live: Live): Usage {
  const usage = live.results().at(-1)?.usage;
  return {
    cacheRead: usage?.cacheReadTokens ?? null, cacheCreation: usage?.cacheCreationTokens ?? null, input: usage?.inputTokens ?? null,
    output: usage?.outputTokens ?? null, ttlSeconds: usage?.cacheTtlSeconds ?? null,
  };
}

const contextOf = (usage: Usage): number | null => (usage.cacheRead === null || usage.cacheCreation === null ? null : usage.cacheRead + usage.cacheCreation);

function contextTokensSeen(live: Live): number | null {
  for (let i = live.events.length - 1; i >= 0; i -= 1) {
    const event = live.events[i]?.event;
    if (event?.kind === 'context_usage') return event.usage.totalTokens;
  }
  return null;
}

// Las herramientas que el keep-alive llegó a usar: `tool_use` de la transcripción DESPUÉS de su mensaje (que sigue en el fichero tras el rewind).
function toolUsesAfter(file: string, kaUuid: string): number | null {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.length > 0).map((line) => JSON.parse(line) as { uuid?: string; message?: { content?: unknown } });
  const at = lines.findIndex((line) => line.uuid === kaUuid);
  if (at < 0) return null;
  return lines.slice(at + 1).filter((line) => Array.isArray(line.message?.content) && line.message.content.some((block: { type?: string }) => block.type === 'tool_use')).length;
}

const newRig = (stateDir: string, virtualTimers: boolean): Rig => new Rig({
  ...CLAUDE_MOUNT, accountDir: join(homedir(), '.claude'), stateDir, keepAlive: DEFAULT_KEEP_ALIVE, virtualTimers,
});

const ratioOf = (read: number | null, base: number | null): number | null => (read === null || base === null || base === 0 ? null : read / base);

// Serie corta (3 turnos): T1 grande, KA (el reloj salta una hora) con su rewind y T3.
async function shortSeries(rig: Rig, cwd: string, bigChars: number): Promise<Rec> {
  const live = rig.open(cwd);
  await live.turn(`${bigText(bigChars)}\n\nResponde solo: listo`);
  const t1 = usageOfLast(live);
  const timer = await attempt(() => rig.until(() => rig.pendingVirtualTimers() > 0, 'temporizador del keep-alive', TIMER_WAIT_MS));
  if (!timer.ok) return { timerRegistered: false, contextTokens: contextTokensSeen(live), hint: 'no se programo el keep-alive: contexto bajo el umbral (usar --big-chars 330000)?', t1 };
  rig.advance(KA_OFFSET_MS);
  const done = await attempt(() => rig.until(() => rig.state.keepAliveTotals().count === 1, 'registro del keep-alive', KA_DONE_WAIT_MS));
  await sleep(500);
  const kaUuid = rig.state.pendingCut(live.sessionId);
  await live.turn('Responde solo: tres');
  const t3 = usageOfLast(live);
  return {
    timerRegistered: true, keepAliveRecorded: done.ok, doneError: done.ok ? null : done.error, contextTokens: contextTokensSeen(live),
    cacheTtlSeconds: t1.ttlSeconds, t1, t3, t3CacheReadRatio: ratioOf(t3.cacheRead, contextOf(t1)),
    kaToolUses: kaUuid === null ? null : toolUsesAfter(live.transcriptPath(), kaUuid),
    kaCount: rig.state.keepAliveTotals().count,
  };
}

// Serie larga (3 turnos, ~70 min, SIN desplazar el reloj): el KA lo dispara el temporizador de Mage a TTL − 60 s y refresca la caché.
async function longSeries(rig: Rig, cwd: string, bigChars: number): Promise<Rec> {
  const live = rig.open(cwd);
  const startedAt = Date.now();
  await live.turn(`${bigText(bigChars)}\n\nResponde solo: listo`);
  const t1 = usageOfLast(live);
  const done = await attempt(() => rig.until(() => rig.state.keepAliveTotals().count === 1, 'keep-alive por el temporizador de Mage', LONG_KA_WAIT_MS));
  const kaFiredAfterMin = Math.round((Date.now() - startedAt) / MS_PER_MINUTE);
  await sleep(Math.max(0, startedAt + LONG_CHECK_AT_MS - Date.now()));
  await live.turn('Responde solo: comprobacion');
  const check = usageOfLast(live);
  return {
    keepAliveRecorded: done.ok, doneError: done.ok ? null : done.error, kaFiredAfterMin, cacheTtlSeconds: t1.ttlSeconds, t1, check,
    checkCacheReadRatio: ratioOf(check.cacheRead, contextOf(t1)), kaCount: rig.state.keepAliveTotals().count,
  };
}

// Borra SOLO las carpetas de transcripciones de las carpetas de trabajo de esta ejecución (comprobando que son las nuestras).
function removeTranscriptFolders(cwds: readonly string[]): string[] {
  const pending: string[] = [];
  for (const cwd of cwds) {
    const folder = join(homedir(), '.claude', 'projects', cwd.replace(NON_ALPHANUMERIC, '-'));
    if (!cwd.includes(SERIES_PREFIX) || !folder.includes(SERIES_PREFIX)) {
      pending.push(`${folder}: no es de esta ejecucion, no se borra`);
      continue;
    }
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  return pending;
}

const newCwd = (): string => realpathSync.native(mkdtempSync(join(tmpdir(), SERIES_PREFIX)));

export { claudeBinary } from './rewind-claude-entry';

export async function run(options: KeepAliveOptions): Promise<Rec> {
  const cwds: string[] = [];
  const stateDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-k-ka-state-')));
  const out: Rec = { realTurns: options.long ? 6 : 3, bigChars: options.bigChars, thresholdTokens: DEFAULT_KEEP_ALIVE.minContextTokens };
  const rigs: Rig[] = [];
  try {
    const rig = newRig(stateDir, true);
    rigs.push(rig);
    const shortCwd = newCwd();
    cwds.push(shortCwd);
    out.corta = await shortSeries(rig, shortCwd, options.bigChars);
    if (options.long) {
      const longRig = newRig(stateDir, false);
      rigs.push(longRig);
      const longCwd = newCwd();
      cwds.push(longCwd);
      out.larga = await longSeries(longRig, longCwd, options.bigChars);
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
  } finally {
    for (const rig of rigs) await rig.stopAll();
    out.pendingToDelete = removeTranscriptFolders(cwds);
    for (const cwd of cwds) rm(cwd);
    rm(stateDir);
  }
  return out;
}
