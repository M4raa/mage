import type { UsageInfo } from '@shared/usage';
import type { ChatStatus, RateLimitNotice } from './types';
import { FIVE_HOUR_WINDOW_MS, formatResetTime } from './usageView';

// Limite de uso (P-028, punto 20). PURO: el reductor, la hidratacion, el banner y el temporizador del
// continuar automatico leen de aqui, asi el aviso dice lo mismo en los cuatro sitios.

export const RATE_LIMIT_LINE = 'Límite de uso alcanzado';

// Texto de Mage (castellano) para la linea del hilo y el banner. El del CLI va en el tooltip.
export function rateLimitLineText(resetsAtMs: number | null): string {
  return resetsAtMs === null ? RATE_LIMIT_LINE : `${RATE_LIMIT_LINE} · se restablece a las ${formatResetTime(resetsAtMs)}`;
}

// El CLI avisa DOS veces del mismo limite (el `rate_limit_event` rechazado, sin texto pero con hora, y el
// `assistant` con `error: "rate_limit"`, con texto y sin hora). Se funden en una sola marca: gana el
// texto no vacio y la hora no nula, y se conserva lo que el usuario ya eligio (continuar automatico).
export function mergeRateLimitNotice(
  previous: RateLimitNotice | undefined,
  incoming: { readonly summary: string; readonly resetsAtMs: number | null },
): RateLimitNotice {
  const summary = incoming.summary.trim().length > 0 ? incoming.summary.trim() : (previous?.summary ?? '');
  const resetsAtMs = incoming.resetsAtMs ?? previous?.resetsAtMs ?? null;
  return previous?.autoContinue === true ? { summary, resetsAtMs, autoContinue: true } : { summary, resetsAtMs };
}

// Hora de reset con la que decidir: la del aviso o, si no la trae, la de la ventana de 5 h del uso de
// la cuenta cuando esta agotada (es la que ha rechazado el turno).
export function effectiveResetMs(notice: RateLimitNotice, usage: UsageInfo | null | undefined): number | null {
  if (notice.resetsAtMs !== null) return notice.resetsAtMs;
  if (usage === null || usage === undefined || usage.fiveHour.utilization < 100) return null;
  return usage.fiveHour.resetsAt;
}

// Margen tras el reset antes de continuar: el endpoint de uso va con lag y un envio en el segundo exacto
// del reset puede volver a chocar con el limite.
export const AUTO_CONTINUE_MARGIN_MS = 60_000;
// Cada cuanto se mira (un intervalo corto aguanta la suspension del equipo; un setTimeout de horas no).
export const AUTO_CONTINUE_POLL_MS = 60_000;
export const AUTO_CONTINUE_TEXT = 'Continúa';

// Por que NO se puede activar el continuar automatico, o null si se puede. Sin hora de reset no hay
// cuando; un reset a mas de 5 h vista es el semanal, y ahi no se gastan turnos solos.
export function autoContinueBlockedReason(resetsAtMs: number | null, now: number): string | null {
  if (resetsAtMs === null) return 'Sin hora de reset: no se puede continuar automáticamente.';
  if (resetsAtMs - now > FIVE_HOUR_WINDOW_MS) return 'Solo para el límite de 5 horas.';
  return null;
}

export interface AutoContinueContext {
  readonly now: number;
  readonly notice: RateLimitNotice | undefined;
  readonly status: ChatStatus | undefined;
  readonly resetsAtMs: number | null;
}

// ¿Toca mandar «Continúa» a esta pestaña? Solo si el usuario lo activo, la pestaña esta parada, hay hora
// de reset y ya paso (con margen). Solo el limite de 5 h: un reset a mas de 5 h vista es el semanal, y
// ahi no se gastan turnos solos.
export function shouldAutoContinue(ctx: AutoContinueContext): boolean {
  if (ctx.notice?.autoContinue !== true) return false;
  if ((ctx.status ?? 'idle') !== 'idle') return false;
  if (ctx.resetsAtMs === null) return false;
  if (ctx.resetsAtMs - ctx.now > FIVE_HOUR_WINDOW_MS) return false;
  return ctx.now >= ctx.resetsAtMs + AUTO_CONTINUE_MARGIN_MS;
}
