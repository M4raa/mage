// Registro PURO de que features estan degradadas y por que (I9, idea de
// OmniRoute). Pensado para el manojo suelto que ya existe hoy sin un sitio comun: el endpoint de uso
// bajo cooldown de 429 (usage/lockoutPolicy.ts), Open VSX sin red, `get_context_usage` cuando el CLI
// lo rechaza (H6, hoy solo un log). Sin consumidor todavia — nada llama a `markDegraded` aun; queda
// listo para el dia que un panel quiera decir "por que falta este dato" en vez de solo no pintarlo.
// Estado INMUTABLE, mismo patron que lockoutPolicy.ts: cada funcion devuelve un estado nuevo.

export interface DegradationState {
  readonly reasonByFeature: Readonly<Record<string, string>>;
}

export const NOT_DEGRADED: DegradationState = { reasonByFeature: {} };

export function isDegraded(state: DegradationState, feature: string): boolean {
  return feature in state.reasonByFeature;
}

// Motivo de la degradacion, o null si `feature` funciona con normalidad.
export function degradationReason(state: DegradationState, feature: string): string | null {
  return state.reasonByFeature[feature] ?? null;
}

// Marca `feature` como degradada con `reason` (obligatorio: un motivo vacio no explica nada al
// usuario y es indistinguible de un error de quien llama). Sobrescribe un motivo anterior.
export function markDegraded(state: DegradationState, feature: string, reason: string): DegradationState {
  if (reason.trim().length === 0) {
    throw new Error(`markDegraded: "${feature}" necesita un motivo no vacio`);
  }
  return { reasonByFeature: { ...state.reasonByFeature, [feature]: reason } };
}

// Quita la degradacion de `feature` (p.ej. al recuperar el servicio). No-op si no estaba degradada.
export function clearDegraded(state: DegradationState, feature: string): DegradationState {
  if (!(feature in state.reasonByFeature)) return state;
  const rest = { ...state.reasonByFeature };
  delete rest[feature];
  return { reasonByFeature: rest };
}
