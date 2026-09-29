// Estado del indicador de "pensando" (M2.6): palabra cambiante + tiempo transcurrido + deteccion de
// inactividad (posible cuelgue). Modulo PURO (sin reloj ni DOM): el componente le pasa los ms ya
// calculados y lo re-renderiza cada segundo. Da feedback de que el turno sigue vivo (antes solo habia
// un "pensando…" fijo que parecia colgado).

import { CLI_SPINNER_VERBS } from './spinnerVerbs.generated';

// Verbos propios de Mage, con el mismo tono que los del CLI (ingles, gerundio); van APARTE de los
// generados para que regenerar la lista no los pise.
const MAGE_SPINNER_VERBS = ['Spellcasting', 'Conjuring', 'Wizarding'] as const;
export const SPINNER_VERBS: readonly string[] = [...CLI_SPINNER_VERBS, ...MAGE_SPINNER_VERBS];
const KNUTH_MULTIPLIER = 2_654_435_761; // hash multiplicativo: dispersa marcas de tiempo cercanas
const STALL_THRESHOLD_MS = 25_000; // sin actividad del motor -> se avisa de posible cuelgue

export interface ThinkingStatus {
  readonly label: string; // verbo del turno (fijo mientras dura, elegido por la semilla)
  readonly elapsedText: string; // "12 s" / "1 m 05 s"
  readonly stalled: boolean; // sin actividad reciente del motor (posible cuelgue)
  readonly sinceActivityText: string; // tiempo desde la ultima actividad (para mostrar cuando stalled)
}

// Un verbo por turno, estable con la misma semilla (el `turnStart`): no rota, como en el CLI.
export function pickSpinnerVerb(seed: number): string {
  const index = (Math.imul(Math.trunc(seed), KNUTH_MULTIPLIER) >>> 0) % SPINNER_VERBS.length;
  return SPINNER_VERBS[index] ?? 'Working';
}

export function computeThinkingStatus(elapsedMs: number, sinceActivityMs: number, seed: number): ThinkingStatus {
  const safeElapsed = Math.max(0, elapsedMs);
  return {
    label: pickSpinnerVerb(seed),
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
