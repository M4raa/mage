import type { ScratchRetention } from '@shared/settings';

// Que carpetas de scratchpad toca borrar, segun la politica del usuario (auditoria B.4.2).
//
// PURO a proposito: aqui solo se DECIDE (entradas + politica + ahora -> nombres a borrar) y quien toca
// el disco es main. Es la unica forma de probar una funcion que borra ficheros sin borrar ninguno.
//
// Contexto medido, por si alguien quiere "alinearlo" con el CLI: Claude Code NO barre su temp nunca.
// Lo que purga con `cleanupPeriodDays` (30 por defecto) vive en `~/.claude` —mensajes, logs MCP,
// pastes, cache de imagenes, worktrees huerfanos y las TRANSCRIPCIONES de `projects/`—, y su scratchpad
// (`<temp>/claude-<uid>/<cwd>/<sessionId>/scratchpad`) se queda donde esta. Asi que las dos limpiezas
// son disjuntas: a los 30 dias el CLI se lleva el `.jsonl` de una conversacion aunque Mage conserve su
// carpeta de trabajo.

export interface ScratchEntry {
  readonly name: string;
  readonly mtimeMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS: Readonly<Record<ScratchRetention, number | null>> = {
  never: null,
  session: 0, // todo lo que sobrevivio a la ejecucion anterior
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};

// Nombres a borrar. Vacio con 'never'. Una entrada con `mtimeMs` no finito (un stat que fallo, un
// reloj raro) se CONSERVA: sin fecha fiable, no se borra.
export function expiredScratchDirs(
  entries: readonly ScratchEntry[],
  retention: ScratchRetention,
  nowMs: number,
): readonly string[] {
  const maxAgeMs = MAX_AGE_MS[retention];
  if (maxAgeMs === null) return [];
  const cutoff = nowMs - maxAgeMs;
  return entries.filter((entry) => Number.isFinite(entry.mtimeMs) && entry.mtimeMs <= cutoff).map((entry) => entry.name);
}

// Cada cuanto se repite el barrido mientras la app sigue abierta. Mismo criterio que Claude Code, que
// reprograma su limpieza cada 24 h para las sesiones que duran dias.
export const SWEEP_INTERVAL_MS = DAY_MS;
