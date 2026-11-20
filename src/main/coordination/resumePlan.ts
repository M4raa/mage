import type { UsageWindowInfo } from '@shared/usage';

// Cuándo reanudar una sesión de Claude que chocó con la ventana de 5 h («Continuar al restablecerse»). PURO: sin reloj ni
// temporizadores; el reloj entra como `now` y quien llama programa lo que se devuelva.

// Margen sobre la hora de restablecimiento: el límite se levanta un poco después de la hora que dice el CLI.
export const RESUME_DELAY_MS = 2 * 60_000;
// Una ventana con este % o más está agotada.
export const EXHAUSTED_PERCENT = 100;

export type ResumeSkipReason = 'weekly' | 'unknown_reset';
export type ResumePlan =
  | { readonly kind: 'schedule'; readonly atMs: number }
  | { readonly kind: 'skip'; readonly reason: ResumeSkipReason };

export interface ResumePlanInput {
  readonly weekly: UsageWindowInfo | null;
  readonly fiveHour: UsageWindowInfo | null;
  readonly now: number;
}

// Solo se reanuda por la ventana de 5 h: con la semanal agotada seguir no serviría de nada, y sin hora de reset no se
// sabe cuándo (no se deduce de ningún texto). Un reset ya pasado se reanuda a `now` + margen.
export function resumePlan(input: ResumePlanInput): ResumePlan {
  const { weekly, fiveHour, now } = input;
  if (!Number.isFinite(now)) throw new Error(`resumePlan: «now» no es un instante válido: ${now}`);
  if (weekly !== null && weekly.utilization >= EXHAUSTED_PERCENT) return { kind: 'skip', reason: 'weekly' };
  const resetsAt = fiveHour?.resetsAt ?? null;
  if (resetsAt === null || !Number.isFinite(resetsAt)) return { kind: 'skip', reason: 'unknown_reset' };
  return { kind: 'schedule', atMs: Math.max(resetsAt, now) + RESUME_DELAY_MS };
}

// «HH:MM» en la hora local de la máquina (la que ve el usuario), con ceros a la izquierda.
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) throw new Error(`formatClock: instante no válido: ${epochMs}`);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
