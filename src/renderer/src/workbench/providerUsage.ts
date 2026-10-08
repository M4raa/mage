import type { TurnUsage } from '@shared/events';
import type { TokenCategoryTotals } from './contextView';

// Uso acumulado de una conversación de Codex o agy, a partir del `usage` de cada `result`. Para estos CLI no hay
// transcripción de Claude de la que sacarlo (ni desglose del contexto), así que el panel de Contexto lo lee de aquí.
// Solo cuenta lo que ha pasado desde que Mage abrió la conversación: no se reconstruye del historial.
//
// La entrada de Codex y de agy YA incluye la caché (`total` = entrada + salida): aquí se guarda tal cual y se separa
// al pintar las categorías.

export interface ProviderUsageTotals {
  readonly turns: number;
  // Todo lo enviado al modelo, caché incluida.
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly thinkingTokens: number;
  // Entrada del ÚLTIMO turno: lo que ocupaba el contexto en esa llamada.
  readonly lastInputTokens: number;
}

const EMPTY: ProviderUsageTotals = { turns: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0, lastInputTokens: 0 };

function counter(value: number | null): number {
  if (value === null) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error(`Contador de tokens invalido al acumular el uso: ${JSON.stringify(value)}`);
  return value;
}

// Suma un turno. Un turno que no trae ni entrada ni salida no cuenta (el proveedor no reportó uso).
export function accumulateProviderUsage(previous: ProviderUsageTotals | undefined, usage: TurnUsage): ProviderUsageTotals | null {
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  const base = previous ?? EMPTY;
  const input = counter(usage.inputTokens);
  return {
    turns: base.turns + 1,
    inputTokens: base.inputTokens + input,
    cachedTokens: base.cachedTokens + Math.min(counter(usage.cacheReadTokens), input),
    outputTokens: base.outputTokens + counter(usage.outputTokens),
    thinkingTokens: base.thinkingTokens + counter(usage.thinkingTokens),
    lastInputTokens: input,
  };
}

// Las cuatro categorías EXCLUYENTES del panel (como las de Claude, que suman el total): entrada sin caché, salida,
// escritura de caché (estos CLI no la informan) y lectura de caché.
export function providerUsageCategoryTotals(totals: ProviderUsageTotals): TokenCategoryTotals {
  const freshInput = totals.inputTokens - totals.cachedTokens;
  return {
    inputTokens: freshInput,
    outputTokens: totals.outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: totals.cachedTokens,
    totalTokens: freshInput + totals.outputTokens + totals.cachedTokens,
  };
}
