import { PLAN_PRICE_MAX_MICRO_USD } from '@shared/settings';

// Precio mensual del plan que teclea el usuario (P-039 D6), en dólares: «200», «19,99», «19.99» o «$20». A micro-USD
// enteros SIN pasar por coma flotante (19,99 × 10⁶ en float da 19989999,999…). Vacío = sin precio.
const MICRO_DIGITS = 6;
const PRICE_PATTERN = /^\$?\s*(\d{1,7})(?:[.,](\d{1,6}))?\s*\$?$/;

export type PlanPriceParse = { readonly kind: 'empty' } | { readonly kind: 'ok'; readonly microUsd: number } | { readonly kind: 'invalid' };

export function parsePlanPriceUsd(text: string): PlanPriceParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  const match = PRICE_PATTERN.exec(trimmed);
  if (match === null) return { kind: 'invalid' };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(MICRO_DIGITS, '0'));
  const microUsd = whole * 10 ** MICRO_DIGITS + fraction;
  return microUsd > PLAN_PRICE_MAX_MICRO_USD ? { kind: 'invalid' } : { kind: 'ok', microUsd };
}

// Para el campo de edición: el precio guardado en dólares, sin ceros de sobra («200», «19.99»).
export function formatPlanPriceUsd(microUsd: number): string {
  if (!Number.isInteger(microUsd) || microUsd < 0) throw new Error(`Precio del plan no valido: ${microUsd}`);
  const whole = Math.floor(microUsd / 10 ** MICRO_DIGITS);
  const fraction = String(microUsd % 10 ** MICRO_DIGITS).padStart(MICRO_DIGITS, '0').replace(/0+$/, '');
  return fraction.length === 0 ? String(whole) : `${whole}.${fraction}`;
}
