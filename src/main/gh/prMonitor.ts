import type { GhPrUpdate, GhSnapshot, GhWatchParams } from '@shared/gh';

// Vigilancia de los PR vinculados a una pestaña, en main y SIN depender del foco (como Claude Desktop:
// el PR se sigue aunque cambies de tarea). Un temporizador por pestaña, nunca uno global: con checks en
// marcha cada 60 s, en reposo cada 5 min, y se para cuando el PR se fusiona o se cierra.

export const POLL_PENDING_MS = 60_000;
export const POLL_IDLE_MS = 5 * 60_000;

export interface PrMonitorDeps {
  readonly fetch: (params: GhWatchParams) => Promise<GhSnapshot>;
  readonly emit: (update: GhPrUpdate) => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly onError: (err: unknown) => void;
}

// Cuanto esperar hasta el siguiente sondeo; null = dejar de vigilar (fusionado o cerrado).
export function nextPollDelayMs(snapshot: GhSnapshot): number | null {
  if (snapshot.kind !== 'pr') return POLL_IDLE_MS;
  if (snapshot.pr.state !== 'open') return null;
  return snapshot.pr.summary.pending > 0 ? POLL_PENDING_MS : POLL_IDLE_MS;
}

// Los checks que estaban en marcha acaban de terminar TODOS (el aviso de escritorio de Desktop).
export function ciJustFinished(previous: GhSnapshot | null, next: GhSnapshot): boolean {
  if (previous?.kind !== 'pr' || next.kind !== 'pr') return false;
  return previous.pr.summary.pending > 0 && next.pr.summary.pending === 0 && next.pr.checks.length > 0;
}

interface Watch {
  params: GhWatchParams;
  last: GhSnapshot | null;
  timer: unknown;
  polling: boolean;
}

export class PrMonitor {
  private readonly watches = new Map<string, Watch>();

  constructor(private readonly deps: PrMonitorDeps) {}

  // Vigilar (o, si ya se vigila, sondear YA: es el «refrescar» de la barra). Cambiar de PR reinicia.
  watch(params: GhWatchParams): void {
    const current = this.watches.get(params.key);
    if (current !== undefined && current.params.number === params.number && current.params.cwd === params.cwd) {
      this.pollNow(current);
      return;
    }
    if (current !== undefined) this.unwatch(params.key);
    const watch: Watch = { params, last: null, timer: null, polling: false };
    this.watches.set(params.key, watch);
    this.pollNow(watch);
  }

  unwatch(key: string): void {
    const watch = this.watches.get(key);
    if (watch === undefined) return;
    if (watch.timer !== null) this.deps.clearTimer(watch.timer);
    this.watches.delete(key);
  }

  // Todas las de un prefijo (las de una ventana que se cierra o se recarga).
  unwatchPrefix(prefix: string): void {
    for (const key of [...this.watches.keys()]) if (key.startsWith(prefix)) this.unwatch(key);
  }

  dispose(): void {
    this.unwatchPrefix('');
  }

  private pollNow(watch: Watch): void {
    if (watch.polling) return;
    if (watch.timer !== null) this.deps.clearTimer(watch.timer);
    watch.timer = null;
    watch.polling = true;
    void this.poll(watch);
  }

  private async poll(watch: Watch): Promise<void> {
    let snapshot: GhSnapshot;
    try {
      snapshot = await this.deps.fetch(watch.params);
    } catch (err) {
      this.deps.onError(err);
      snapshot = { kind: 'off', reason: 'error' };
    }
    watch.polling = false;
    // Se dejo de vigilar mientras se leia: ni se emite ni se reprograma.
    if (this.watches.get(watch.params.key) !== watch) return;
    this.deps.emit({ key: watch.params.key, snapshot, ciFinished: ciJustFinished(watch.last, snapshot) });
    if (snapshot.kind === 'pr') watch.last = snapshot;
    const delay = nextPollDelayMs(snapshot);
    if (delay === null) {
      this.watches.delete(watch.params.key);
      return;
    }
    watch.timer = this.deps.setTimer(() => this.pollNow(watch), delay);
  }
}
