import type { WidgetOutcome, WidgetSessionsPayload } from '@shared/widget';
import type { ConversationSnapshot } from '@shared/coordination';
import type { SequencedSessionEvent } from '../coordination/sessionCoordinator';
import { toWidgetSessionView } from './widgetSessionView';

// El coordinador visto por el widget (SessionCoordinator lo cumple estructuralmente).
export interface WidgetTrackedSessions {
  listSessions(): readonly ConversationSnapshot[];
  subscribe(sessionId: string, listener: { readonly sink: (event: SequencedSessionEvent) => void; readonly onClosed: () => void }): { readonly unsubscribe: () => void };
}

export interface WidgetSessionTrackerDeps {
  readonly sessions: WidgetTrackedSessions;
  readonly onChange: (payload: WidgetSessionsPayload) => void;
  // Hay al menos una petición que el widget no había visto (U-N3: expandirse).
  readonly onNewRequest: () => void;
  // Agrupa los avisos de una ráfaga en uno (queueMicrotask en producción).
  readonly defer: (fn: () => void) => void;
  // Temporizador repetido cancelable (setInterval/clearInterval en producción).
  readonly every: (fn: () => void, ms: number) => () => void;
}

// ponytail: sondeo de 1 s para ver sesiones NUEVAS (el coordinador no avisa al crear); un aviso de alta si algún día hace falta.
export const WIDGET_SYNC_INTERVAL_MS = 1_000;

// Eventos que pueden cambiar lo que el widget pinta; el resto (deltas de texto, etc.) es la mayoría del tráfico y no avisa.
const RELEVANT_EVENT_KINDS: ReadonlySet<string> = new Set([
  'session_state', 'session_restarting', 'permission_request', 'permission_resolved', 'permission_cancelled',
  'permission_auto_answered', 'elicitation_request', 'elicitation_resolved', 'elicitation_cancelled',
  'result', 'error', 'background_expired',
]);

interface TrackedSession {
  readonly unsubscribe: () => void;
  outcome: WidgetOutcome;
}

// Sigue las sesiones vivas del coordinador (fin, error, peticiones nuevas) y avisa al widget agrupando ráfagas.
export class WidgetSessionTracker {
  private readonly tracked = new Map<string, TrackedSession>();
  private seen = new Set<string>(); // `${sessionId}:${requestId}` de las peticiones ya avisadas
  private scheduled = false;
  private cancelTimer: (() => void) | null = null;

  constructor(private readonly deps: WidgetSessionTrackerDeps) {}

  // Arranca el seguimiento; si ya está en marcha no hace nada.
  start(): void {
    if (this.cancelTimer !== null) return;
    this.cancelTimer = this.deps.every(() => this.sync(), WIDGET_SYNC_INTERVAL_MS);
    this.sync();
  }

  // Para el seguimiento y vacía el estado. Idempotente.
  stop(): void {
    if (this.cancelTimer === null) return;
    this.cancelTimer();
    this.cancelTimer = null;
    for (const session of this.tracked.values()) session.unsubscribe();
    this.tracked.clear();
    this.seen = new Set();
  }

  // Alinea las suscripciones con las sesiones vivas del coordinador.
  sync(): void {
    const live = this.deps.sessions.listSessions();
    const liveIds = new Set(live.map((s) => s.sessionId));
    let changed = false;
    for (const id of liveIds) {
      if (this.tracked.has(id)) continue;
      this.add(id);
      changed = true;
    }
    for (const id of [...this.tracked.keys()]) {
      if (liveIds.has(id)) continue;
      this.drop(id);
      changed = true;
    }
    if (changed) this.schedule();
  }

  // El usuario ya vio el resultado de esa sesión (fue a ella): el outcome vuelve a 'none'.
  acknowledge(sessionId: string): void {
    const session = this.tracked.get(sessionId);
    if (session === undefined) return;
    session.outcome = 'none';
    this.schedule();
  }

  // La foto de ahora, sin avisar.
  current(): WidgetSessionsPayload {
    const sessions = this.deps.sessions.listSessions()
      .filter((snapshot) => this.tracked.has(snapshot.sessionId))
      .map((snapshot) => toWidgetSessionView(snapshot, this.tracked.get(snapshot.sessionId)?.outcome ?? 'none'));
    return { sessions };
  }

  private add(sessionId: string): void {
    const subscription = this.deps.sessions.subscribe(sessionId, {
      sink: (event) => this.onEvent(sessionId, event),
      onClosed: () => this.drop(sessionId),
    });
    this.tracked.set(sessionId, { unsubscribe: subscription.unsubscribe, outcome: 'none' });
  }

  private drop(sessionId: string): void {
    const session = this.tracked.get(sessionId);
    if (session === undefined) return;
    session.unsubscribe();
    this.tracked.delete(sessionId);
    this.schedule();
  }

  private onEvent(sessionId: string, payload: SequencedSessionEvent): void {
    const event = payload.event;
    const session = this.tracked.get(sessionId);
    if (session !== undefined) session.outcome = outcomeAfter(event, session.outcome);
    if (RELEVANT_EVENT_KINDS.has(event.kind)) this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.deps.defer(() => {
      this.scheduled = false;
      this.emit();
    });
  }

  private emit(): void {
    if (this.cancelTimer === null) return; // se llamó a stop() entre medias
    const payload = this.current();
    const keys = new Set(payload.sessions.flatMap((s) => s.requests.map((r) => `${s.sessionId}:${r.requestId}`)));
    const fresh = [...keys].some((key) => !this.seen.has(key));
    this.seen = keys; // se REEMPLAZA: así el conjunto no crece
    this.deps.onChange(payload);
    if (fresh) this.deps.onNewRequest();
  }
}

// Resultado del último turno tras un evento: fin y error lo fijan; un turno nuevo lo borra.
function outcomeAfter(event: SequencedSessionEvent['event'], current: WidgetOutcome): WidgetOutcome {
  if (event.kind === 'result') return event.result.isError ? 'error' : 'finished';
  if (event.kind === 'error') return 'error';
  if (event.kind === 'session_state' && event.state === 'running') return 'none';
  return current;
}
