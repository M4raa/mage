import type { UsageInfo } from '@shared/usage';
import type { UsageWindow } from './types';

// Mapeo PURO del uso de dominio (UsageInfo, seguro) a la presentacion que consume la UI. Sin efectos
// ni dependencia del reloj global: `now` se inyecta (para la cuenta atras hasta el reset).

// Umbrales por defecto de alerta sobre el % consumido de una ventana (configurables en M3).
export const USAGE_WARN_PCT = 80;
export const USAGE_CRIT_PCT = 95;

export type UsageSeverity = 'ok' | 'warn' | 'critical';

export interface UsageThresholds {
  readonly warn: number;
  readonly crit: number;
}

const DEFAULT_THRESHOLDS: UsageThresholds = { warn: USAGE_WARN_PCT, crit: USAGE_CRIT_PCT };

// Barra "por-modelo" derivada de limits[] (solo los activos): etiqueta + % + severidad.
export interface PerModelBar {
  readonly label: string;
  readonly pct: number;
  readonly severity: UsageSeverity;
}

// Severidad de un % consumido segun umbrales. Limites: >=crit critico, >=warn aviso, resto ok.
export function severityForPct(pct: number, thresholds: UsageThresholds = DEFAULT_THRESHOLDS): UsageSeverity {
  if (pct >= thresholds.crit) return 'critical';
  if (pct >= thresholds.warn) return 'warn';
  return 'ok';
}

// Mapea las ventanas 5h/semanal a la forma {pct,label} que ya consumen StatusBar/UsagePanel/Popover.
// `label` es la cuenta atras hasta el reset (o "—" si el endpoint no lo aporta).
export function toUsageWindows(info: UsageInfo, now: number): { readonly fiveHour: UsageWindow; readonly weekly: UsageWindow } {
  return {
    fiveHour: { pct: clampPct(info.fiveHour.utilization), label: formatCountdown(info.fiveHour.resetsAt, now) },
    weekly: { pct: clampPct(info.sevenDay.utilization), label: formatCountdown(info.sevenDay.resetsAt, now) },
  };
}

// Barras por-modelo desde los limits activos. Etiqueta preferente: group; si no, kind.
export function perModelBars(info: UsageInfo, thresholds: UsageThresholds = DEFAULT_THRESHOLDS): readonly PerModelBar[] {
  return info.limits
    .filter((limit) => limit.isActive)
    .map((limit) => ({
      label: limit.group ?? limit.kind,
      pct: clampPct(limit.percent),
      severity: severityForPct(limit.percent, thresholds),
    }));
}

// Formatea el credito de API (amount_minor en unidades menores, enteras) a texto. 0 => aclara que no
// factura API. Nunca usa float para el dinero: divide por 100 solo en la presentacion final.
export function formatApiCredits(amountMinor: number | null): string {
  if (amountMinor === null) return '—';
  const major = (amountMinor / 100).toFixed(2);
  return amountMinor === 0 ? `${major} $ · no factura API` : `${major} $`;
}

// --- Proyeccion de agotamiento -------------------------------------------------------------------
//
// El porcentaje solo no contesta la pregunta que de verdad tiene el usuario: "¿me da la ventana para
// terminar lo que estoy haciendo?". Con `utilization` y `resetsAt` se puede responder sin muestrear
// nada: sabemos cuanto llevamos consumido y cuanto tiempo de ventana ha pasado, asi que el ritmo medio
// sale de una division. Es una media de TODA la ventana, no una tasa instantanea -- deliberadamente:
// el propio spike de M1.0 midio que `utilization` es "un entero grueso CON LAG", asi que una tasa
// derivada de los ultimos minutos seria ruido con pinta de precision.

// Duracion de cada ventana del plan. La de 5h la fija el nombre; la "semanal" del endpoint es
// `seven_day`, 7 dias exactos.
export const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type UsageProjection =
  // No se puede proyectar (sin fecha de reset, reloj incoherente, o aun no se ha consumido nada).
  | { readonly kind: 'unknown' }
  // Ya se agoto la ventana.
  | { readonly kind: 'exhausted' }
  // Al ritmo actual la ventana NO se agota antes de resetearse. Es la respuesta util mas frecuente.
  | { readonly kind: 'safe' }
  // Al ritmo actual se agota dentro de `etaMs`, ANTES del reset.
  | { readonly kind: 'depleting'; readonly etaMs: number };

// Proyecta cuando se agotaria una ventana al ritmo medio de lo que va de ventana.
// `pct` es el consumido [0,100]; `resetsAt` el epoch ms del reset; `windowMs` la duracion del plan.
export function projectWindowExhaustion(
  pct: number,
  resetsAt: number | null,
  windowMs: number,
  now: number,
): UsageProjection {
  if (resetsAt === null || !Number.isFinite(pct) || windowMs <= 0) return { kind: 'unknown' };
  if (pct >= 100) return { kind: 'exhausted' };
  if (pct <= 0) return { kind: 'safe' }; // sin consumo no hay ritmo que proyectar

  const remainingWindowMs = resetsAt - now;
  if (remainingWindowMs <= 0) return { kind: 'unknown' }; // el reset ya paso: el dato esta rancio
  const elapsedMs = windowMs - remainingWindowMs;
  // Reloj incoherente o `resetsAt` mas lejos que la propia ventana: no inventamos un ritmo.
  if (elapsedMs <= 0) return { kind: 'unknown' };

  const pctPerMs = pct / elapsedMs;
  const etaMs = (100 - pct) / pctPerMs;
  // Si se agota DESPUES del reset, no se agota: la ventana se repone antes.
  return etaMs >= remainingWindowMs ? { kind: 'safe' } : { kind: 'depleting', etaMs: Math.round(etaMs) };
}

// Texto corto para la UI. `null` cuando no hay nada util que decir (no se pinta la linea).
export function formatProjection(projection: UsageProjection): string | null {
  if (projection.kind === 'unknown') return null;
  if (projection.kind === 'safe') return 'A este ritmo no se agota antes del reset';
  if (projection.kind === 'exhausted') return 'Ventana agotada';
  return `A este ritmo se agota en ${formatDuration(projection.etaMs)}`;
}

// Duracion legible a partir de ms (misma escala que la cuenta atras del reset, para que las dos
// lineas se lean igual).
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} m`;
  return `${minutes} m`;
}

// % entero saneado a [0,100] (el endpoint puede exceder 100 por redondeos; la barra no debe romperse).
function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Hora local ("15:04") a la que se restablece el limite. El banner de limite alcanzado usa ESTO y no
// una cuenta atras: su texto se calcula una vez y nada lo vuelve a renderizar, asi que un "en 3 h 12 m"
// se quedaba congelado mintiendo durante horas. Una hora absoluta no caduca.
export function formatResetTime(resetsAt: number): string {
  if (!Number.isFinite(resetsAt)) throw new Error(`resetsAt invalido al formatear la hora de reset: ${resetsAt}`);
  return new Date(resetsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Cuenta atras legible desde un epoch ms de reset. null => "—"; <=0 => "ahora"; si no, la unidad
// mas gruesa relevante ("2 d 3 h", "1 h 24 m", "24 m").
export function formatCountdown(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return '—';
  const remainingMs = resetsAt - now;
  if (remainingMs <= 0) return 'ahora';

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} m`;
  return `${minutes} m`;
}
