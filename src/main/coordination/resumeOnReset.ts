import type { MageEvent } from '@shared/events';
import { localized, type LocalizedText } from '@shared/i18n/localizedText';
import type { UsageInfo } from '@shared/usage';
import type { SessionLogFn } from '../engine/agentSession';
import { formatClock, resumePlan } from './resumePlan';
import type { ResumePlan } from './resumePlan';

// «Continuar al restablecerse»: si una sesión de Claude por suscripción choca con la ventana de 5 h, main le manda
// «continúa» cuando se levanta. El booleano vive en la sesión coordinada (`store`); aquí solo está lo programado, que se
// pierde si Mage se reinicia. Todo lo de fuera (reloj, temporizador, uso, envío, aviso) entra por `deps`.

// Lo que lee el modelo: castellano, como el resto de lo que main le manda.
export const RESUME_TEXT = 'continúa';

export interface ResumeOnResetDeps {
  readonly store: { get(sessionId: string): boolean; set(sessionId: string, enabled: boolean): void };
  // El uso de la cuenta de la sesión (puede lanzar: sin hora de reset no se programa nada).
  readonly usage: (sessionId: string) => Promise<UsageInfo | null>;
  // El envío normal de la sesión (con turno en marcha, espera en la cola).
  readonly send: (sessionId: string, text: string) => void;
  // Un aviso para la pestaña de la sesión.
  readonly notify: (sessionId: string, text: LocalizedText) => void;
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  readonly now: () => number;
  readonly log: SessionLogFn;
}

interface Scheduled {
  readonly atMs: number;
  readonly cancel: () => void;
}

export class ResumeOnReset {
  private readonly scheduled = new Map<string, Scheduled>();
  // Sesiones con una consulta de uso en curso: dos `rate_limit` seguidos no la duplican. `stale` marca que, mientras se
  // consultaba, algo (un envío, apagar la opción, cerrar) dejó sin sentido lo que salga.
  private readonly evaluating = new Map<string, { stale: boolean }>();
  // Sesiones a las que este mismo objeto está enviando «continúa»: ese envío no cuenta como del usuario.
  private readonly sending = new Set<string>();

  constructor(private readonly deps: ResumeOnResetDeps) {}

  isEnabled(sessionId: string): boolean {
    return this.deps.store.get(sessionId);
  }

  // Hora (epoch ms) a la que se reanudará, o null si no hay nada programado.
  scheduledAt(sessionId: string): number | null {
    return this.scheduled.get(sessionId)?.atMs ?? null;
  }

  set(sessionId: string, enabled: boolean): void {
    this.deps.store.set(sessionId, enabled);
    if (!enabled) this.cancel(sessionId);
  }

  onEvent(sessionId: string, event: MageEvent): void {
    if (event.kind === 'rate_limit') void this.onRateLimit(sessionId);
    // Un `/clear` cambia la sesión de conversación: lo programado era de la anterior.
    if (event.kind === 'conversation_reset') this.cancel(sessionId);
  }

  // Cualquier envío que no sea el nuestro (el usuario, o su creadora) se adelanta a lo programado.
  onUserSend(sessionId: string): void {
    if (this.sending.has(sessionId)) return;
    this.cancel(sessionId);
  }

  // La sesión se cierra o se para.
  forget(sessionId: string): void {
    this.cancel(sessionId);
  }

  private cancel(sessionId: string): void {
    this.scheduled.get(sessionId)?.cancel();
    this.scheduled.delete(sessionId);
    const evaluation = this.evaluating.get(sessionId);
    if (evaluation !== undefined) evaluation.stale = true;
  }

  private async onRateLimit(sessionId: string): Promise<void> {
    if (!this.isEnabled(sessionId) || this.scheduled.has(sessionId) || this.evaluating.has(sessionId)) return;
    const evaluation = { stale: false };
    this.evaluating.set(sessionId, evaluation);
    try {
      const plan = await this.planFor(sessionId);
      if (!evaluation.stale && this.isEnabled(sessionId)) this.apply(sessionId, plan);
    } finally {
      this.evaluating.delete(sessionId);
    }
  }

  private async planFor(sessionId: string): Promise<ResumePlan> {
    try {
      const usage = await this.deps.usage(sessionId);
      return resumePlan({ weekly: usage?.sevenDay ?? null, fiveHour: usage?.fiveHour ?? null, now: this.deps.now() });
    } catch (error) {
      this.deps.log('warn', 'No se pudo leer el uso para reanudar la sesión', { sessionId, error: error instanceof Error ? error.message : String(error) });
      return { kind: 'skip', reason: 'unknown_reset' };
    }
  }

  private apply(sessionId: string, plan: ResumePlan): void {
    if (plan.kind === 'skip') {
      const key = plan.reason === 'weekly' ? 'chat.resumeOnReset.weekly' : 'chat.resumeOnReset.unknownReset';
      this.deps.notify(sessionId, localized(key));
      return;
    }
    const cancel = this.deps.setTimer(() => this.fire(sessionId), Math.max(0, plan.atMs - this.deps.now()));
    this.scheduled.set(sessionId, { atMs: plan.atMs, cancel });
    this.deps.notify(sessionId, localized('chat.resumeOnReset.scheduled', { time: formatClock(plan.atMs) }));
  }

  private fire(sessionId: string): void {
    this.scheduled.delete(sessionId);
    if (!this.isEnabled(sessionId)) return;
    this.sending.add(sessionId);
    try {
      this.deps.send(sessionId, RESUME_TEXT);
    } catch (error) {
      this.deps.log('warn', 'No se pudo reanudar la sesión al restablecerse el límite', { sessionId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.sending.delete(sessionId);
    }
  }
}
