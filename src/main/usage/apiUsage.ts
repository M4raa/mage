import type { ApiUsageAmounts, ApiUsageSnapshot } from '@shared/usage';
import type { ResultInfo } from '@shared/events';

const MICRO_USD = 6;
const DECIMAL = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

// El CLI da USD como número JSON. Se pasa inmediatamente a texto decimal y de ahí a enteros.
export function parseMicroUsd(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = DECIMAL.exec(String(value));
  if (match === null) return null;
  const digits = BigInt(`${match[1]}${match[2] ?? ''}`);
  const places = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
  if (!Number.isSafeInteger(places)) return null;
  const shift = MICRO_USD - places;
  if (Math.abs(shift) > 100) return null;
  const amount = shift >= 0 ? digits * 10n ** BigInt(shift) : (digits + 5n * 10n ** BigInt(-shift - 1)) / 10n ** BigInt(-shift);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

export function apiAmountsOf(result: ResultInfo): ApiUsageAmounts | null {
  const usage = result.usage;
  if (usage === undefined || result.costMicroUsd === undefined) return null;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (![inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens, result.costMicroUsd]
    .every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens, costMicroUsd: result.costMicroUsd };
}

export function addApiTurn(previous: ApiUsageSnapshot | null, turn: ApiUsageAmounts, nowMs: number): ApiUsageSnapshot {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error(`Fecha de uso API invalida: ${nowMs}`);
  const totals = previous?.totals;
  return {
    turns: sumSafe(previous?.turns ?? 0, 1),
    totals: {
      inputTokens: sumSafe(totals?.inputTokens ?? 0, turn.inputTokens),
      outputTokens: sumSafe(totals?.outputTokens ?? 0, turn.outputTokens),
      cacheReadTokens: sumSafe(totals?.cacheReadTokens ?? 0, turn.cacheReadTokens),
      cacheCreationTokens: sumSafe(totals?.cacheCreationTokens ?? 0, turn.cacheCreationTokens),
      totalTokens: sumSafe(totals?.totalTokens ?? 0, turn.totalTokens),
      costMicroUsd: sumSafe(totals?.costMicroUsd ?? 0, turn.costMicroUsd),
    },
    lastTurn: turn,
    updatedAtMs: nowMs,
  };
}

function sumSafe(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < 0) throw new Error(`Acumulado de uso API fuera de rango: ${a} + ${b}`);
  return sum;
}
