// Estado del indicador de "pensando" (M2.6): palabra cambiante + tiempo transcurrido + deteccion de
// inactividad (posible cuelgue). Modulo PURO (sin reloj ni DOM): el componente le pasa los ms ya
// calculados y lo re-renderiza cada segundo. Da feedback de que el turno sigue vivo (antes solo habia
// un "pensando…" fijo que parecia colgado).

const WORDS = ['pensando', 'analizando', 'trabajando', 'procesando', 'razonando'] as const;
const WORD_INTERVAL_MS = 4000; // cada cuanto cambia la palabra
const STALL_THRESHOLD_MS = 25_000; // sin actividad del motor -> se avisa de posible cuelgue

export interface ThinkingStatus {
  readonly label: string; // palabra actual (cambia con el tiempo)
  readonly elapsedText: string; // "12 s" / "1 m 05 s"
  readonly stalled: boolean; // sin actividad reciente del motor (posible cuelgue)
  readonly sinceActivityText: string; // tiempo desde la ultima actividad (para mostrar cuando stalled)
}

export function computeThinkingStatus(elapsedMs: number, sinceActivityMs: number): ThinkingStatus {
  const safeElapsed = Math.max(0, elapsedMs);
  const wordIndex = Math.floor(safeElapsed / WORD_INTERVAL_MS) % WORDS.length;
  return {
    label: WORDS[wordIndex] ?? WORDS[0],
    elapsedText: formatElapsed(safeElapsed),
    stalled: sinceActivityMs >= STALL_THRESHOLD_MS,
    sinceActivityText: formatElapsed(sinceActivityMs),
  };
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min} m ${sec.toString().padStart(2, '0')} s`;
}
