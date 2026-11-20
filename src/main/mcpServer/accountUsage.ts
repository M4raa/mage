import type { UsageInfo, UsageWindowInfo } from '@shared/usage';
import type { UsageAccountEntry, UsageWindow } from './types';

// Lo que `mage_get_usage` cuenta de cada cuenta. PURO: sin reloj, sin red ni disco; el puerto de main pone el uso ya leído.
// Solo las cuentas de suscripción de Claude y Codex tienen ventanas; las de API y agy las dejan en null.

export const MAX_USAGE_ERROR_CHARS = 200;
const MAX_PERCENT = 100;

export interface UsageAccount {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly billing: UsageAccountEntry['billing'];
}

// Porcentaje entero 0–100 (el endpoint da enteros gruesos; el stream, fracciones ya redondeadas) y el reset en ISO UTC.
// Un valor que no es un número finito no se inventa: la ventana entera es null.
export function usageWindowOf(window: UsageWindowInfo | undefined): UsageWindow | null {
  if (window === undefined || !Number.isFinite(window.utilization)) return null;
  const percent = Math.min(MAX_PERCENT, Math.max(0, Math.round(window.utilization)));
  return { percent, resetsAt: isoOrNull(window.resetsAt) };
}

function isoOrNull(epochMs: number | null): string | null {
  if (epochMs === null || !Number.isFinite(epochMs)) return null;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hasWindows(account: UsageAccount): boolean {
  return account.billing === 'subscription' && (account.provider === 'claude' || account.provider === 'codex');
}

export function usageEntryOf(account: UsageAccount, usage: UsageInfo | null): UsageAccountEntry {
  const base = { accountId: account.id, provider: account.provider, name: account.name, billing: account.billing };
  if (usage === null || !hasWindows(account)) return { ...base, fiveHour: null, weekly: null };
  return { ...base, fiveHour: usageWindowOf(usage.fiveHour), weekly: usageWindowOf(usage.sevenDay) };
}

// Una cuenta que falla va con su error y sin ventanas: no tumba a las demás. El texto se acota (nunca lleva credenciales).
export function failedUsageEntry(account: UsageAccount, cause: unknown): UsageAccountEntry {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return { accountId: account.id, provider: account.provider, name: account.name, billing: account.billing, fiveHour: null, weekly: null, error: `usage_unavailable: ${reason}`.slice(0, MAX_USAGE_ERROR_CHARS) };
}
