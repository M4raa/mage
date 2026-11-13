import type { UsageHistory } from '@shared/usageHistory';

// De dónde lee «Cuentas y consumo» su historial. Es un objeto (no una función suelta) para que verify:gui sustituya
// `load` por un historial sembrado a través de `__mageDev` (devBridge.ts). En producción, siempre el IPC.
export const usageHistorySource: { load: () => Promise<UsageHistory> } = { load: () => window.mage.getUsageHistory() };
