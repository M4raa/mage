// Consumo por días y cuentas para «Cuentas y consumo» (P-038 V11). Cruza IPC: solo agregados, ningún texto.

// Día LOCAL del usuario, `YYYY-MM-DD`.
export type DayKey = string;

export interface DayTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly turns: number; // respuestas del modelo (mensajes `assistant` distintos)
}

export interface DailyTokens extends DayTokens {
  readonly day: DayKey;
}

// Lo más alto que se vio ese día de cada ventana de la suscripción (0..100), o null si no se miró.
export interface DailyWindows {
  readonly day: DayKey;
  readonly fiveHourMax: number | null;
  readonly sevenDayMax: number | null;
}

export interface AccountUsageHistory {
  readonly accountId: string;
  readonly days: readonly DailyTokens[]; // ordenados por día, solo los que tienen consumo
  readonly windows: readonly DailyWindows[];
}

export interface UsageHistory {
  readonly generatedAt: number; // epoch ms
  readonly fromDay: DayKey; // primer día que cubre (incluido)
  readonly accounts: readonly AccountUsageHistory[];
  // Conversaciones que el índice de Mage no sabe con qué cuenta se usaron (p. ej. las del CLI en la terminal).
  readonly unattributed: readonly DailyTokens[];
}

export const EMPTY_DAY: DayTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 };

export function totalTokens(day: DayTokens): number {
  return day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheCreationTokens;
}

export function addDays(a: DayTokens, b: DayTokens): DayTokens {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    turns: a.turns + b.turns,
  };
}
