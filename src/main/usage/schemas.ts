import { z } from 'zod';
import type { UsageInfo, UsageLimit, UsageWindowInfo } from '@shared/usage';

// FRONTERA de confianza del endpoint GET /api/oauth/usage. Validacion LAXA a proposito: el protocolo
// no es un contrato estable, asi que solo exigimos que los campos de los que dependemos, cuando
// existan, tengan el tipo correcto; el resto se ignora (passthrough) y se rellena con defaults
// seguros al mapear. Nunca lanza por campos extra/desconocidos: solo por tipos incompatibles.

// resets_at puede llegar como ISO string o epoch (segundos o ms). Aqui se acepta cualquiera de las
// dos formas; la conversion a epoch ms se hace en parseEpochMs (parseo seguro, nunca new Date crudo).
const EpochOrIso = z.union([z.string(), z.number()]).nullish();

const WindowSchema = z
  .object({
    utilization: z.number().nullish(),
    resets_at: EpochOrIso,
  })
  .passthrough();

const LimitSchema = z
  .object({
    kind: z.string().nullish(),
    group: z.string().nullish(),
    percent: z.number().nullish(),
    severity: z.string().nullish(),
    resets_at: EpochOrIso,
    is_active: z.boolean().nullish(),
  })
  .passthrough();

const SpendSchema = z
  .object({
    used: z.object({ amount_minor: z.number().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export const UsageResponseSchema = z
  .object({
    five_hour: WindowSchema.nullish(),
    seven_day: WindowSchema.nullish(),
    limits: z.array(LimitSchema).nullish(),
    spend: SpendSchema.nullish(),
  })
  .passthrough();

export type UsageResponse = z.infer<typeof UsageResponseSchema>;

// Umbral por debajo del cual un numero-epoch se interpreta como SEGUNDOS (no ms): ~sabado de 2001 en
// ms, pero ~a decadas en segundos. Cualquier epoch real en ms actual lo supera con creces.
const EPOCH_SECONDS_CEILING = 1e12;

// Convierte un valor de fecha externo (ISO string o epoch en s/ms) a epoch ms. Devuelve null si es
// ausente o no parseable (parseo seguro en la frontera: nunca propaga NaN ni un Date invalido).
export function parseEpochMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value < EPOCH_SECONDS_CEILING ? Math.round(value * 1000) : Math.round(value);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// Mapea la respuesta validada al tipo de dominio SEGURO (sin token ni datos sensibles). Rellena
// defaults seguros donde el endpoint no aporte el campo (utilization 0, listas vacias, resets null).
export function toUsageInfo(raw: UsageResponse, fetchedAt: number): UsageInfo {
  return {
    fiveHour: toWindow(raw.five_hour),
    sevenDay: toWindow(raw.seven_day),
    limits: (raw.limits ?? []).map(toLimit),
    apiCreditsMinor: typeof raw.spend?.used?.amount_minor === 'number' ? raw.spend.used.amount_minor : null,
    fetchedAt,
  };
}

function toWindow(window: UsageResponse['five_hour']): UsageWindowInfo {
  return {
    utilization: typeof window?.utilization === 'number' ? window.utilization : 0,
    resetsAt: parseEpochMs(window?.resets_at),
  };
}

function toLimit(limit: z.infer<typeof LimitSchema>): UsageLimit {
  return {
    kind: typeof limit.kind === 'string' ? limit.kind : '',
    group: typeof limit.group === 'string' ? limit.group : null,
    percent: typeof limit.percent === 'number' ? limit.percent : 0,
    severity: typeof limit.severity === 'string' ? limit.severity : null,
    resetsAt: parseEpochMs(limit.resets_at),
    isActive: limit.is_active === true,
  };
}
