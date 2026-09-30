// Guarda de uso de la comprobacion de turno real de `verify:gui`: antes de gastar un turno de la
// suscripcion, mira cuanto se ha gastado ya. Modulo PURO (sin red ni stdin) para poder testearlo.
//
// Regla del usuario: con MAS del 70 % gastado se avisa y se deja elegir entre real y local (servidor
// falso); sin nadie delante (no interactivo) se elige local y el informe lo dice. Un uso que no se ha
// podido leer se trata igual que uno por encima del umbral: no saber cuanto queda no es permiso para
// gastar.

export const USAGE_GUARD_THRESHOLD_PERCENT = 70;
export const TURN_TARGETS = ['real', 'local'];

// Porcentaje gastado mas alto entre las ventanas de 5 h y 7 dias y los limites activos (el que antes se
// agote es el que manda), o null si el uso no trae ningun numero valido.
export function spentPercent(usage) {
  if (usage === null || typeof usage !== 'object') return null;
  const windows = [usage.fiveHour?.utilization, usage.sevenDay?.utilization];
  const limits = Array.isArray(usage.limits) ? usage.limits.filter((limit) => limit?.isActive === true).map((limit) => limit.percent) : [];
  const valid = [...windows, ...limits].filter((value) => typeof value === 'number' && Number.isFinite(value));
  return valid.length === 0 ? null : Math.max(...valid);
}

// Decide contra que se lanza el turno. `forced` = lo elegido con `--turn=real|local` (o null).
// Devuelve `ask` solo si hay alguien delante para contestar.
export function decideTurnTarget({ spent, forced, interactive }) {
  if (forced !== null && forced !== undefined) {
    if (!TURN_TARGETS.includes(forced)) throw new Error(`--turn solo admite real o local: ${JSON.stringify(forced)}`);
    return { target: forced, reason: `elegido con --turn=${forced}${describeSpent(spent)}` };
  }
  if (spent !== null && spent <= USAGE_GUARD_THRESHOLD_PERCENT) {
    return { target: 'real', reason: `uso gastado ${spent} % ≤ ${USAGE_GUARD_THRESHOLD_PERCENT} %` };
  }
  const why = spent === null ? 'no se pudo leer el uso de la cuenta' : `uso gastado ${spent} % > ${USAGE_GUARD_THRESHOLD_PERCENT} %`;
  if (interactive) return { target: 'ask', reason: why };
  return { target: 'local', reason: `${why}; sin terminal interactiva se elige local (servidor falso)` };
}

// Respuesta a la pregunta de la terminal. Vacio o cualquier otra cosa = local: el lado que no gasta.
export function parseTurnAnswer(answer) {
  return /^\s*r(eal)?\s*$/i.test(answer ?? '') ? 'real' : 'local';
}

function describeSpent(spent) {
  return spent === null ? ' (uso sin leer)' : ` (uso gastado ${spent} %)`;
}
