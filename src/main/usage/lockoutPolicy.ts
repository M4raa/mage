// Modulo PURO de lockout temporal por clave (I9, patron de OmniRoute). Un
// "lockout" es: tras un fallo de la clase que se decida bloquear (429, circuito abierto...), no
// reintentar esa clave hasta que pase un cooldown. Generaliza a un modulo reutilizable el
// `Map<string, number>` que `usageService.ts` (I8) manejaba a mano; cualquier otro sitio con el mismo
// problema (el gateway multi-proveedor, un futuro cliente de Open VSX...) puede usar este en vez de
// reinventarlo. Estado INMUTABLE (igual que el resto de modulos puros del proyecto): cada funcion
// devuelve un `LockoutState` nuevo, nunca muta el que recibe.

export interface LockoutState {
  readonly lockedUntilByKey: Readonly<Record<string, number>>;
}

export const EMPTY_LOCKOUT_STATE: LockoutState = { lockedUntilByKey: {} };

// ¿Sigue bloqueada `key` en el instante `nowMs`?
export function isLockedOut(state: LockoutState, key: string, nowMs: number): boolean {
  const until = state.lockedUntilByKey[key];
  return until !== undefined && nowMs < until;
}

// Milisegundos que quedan de bloqueo (0 si no esta bloqueada o ya expiro).
export function remainingLockoutMs(state: LockoutState, key: string, nowMs: number): number {
  const until = state.lockedUntilByKey[key];
  return until === undefined ? 0 : Math.max(0, until - nowMs);
}

// Bloquea `key` hasta `nowMs + durationMs`. Sobrescribe cualquier bloqueo anterior de la misma clave
// (el ultimo fallo manda). `durationMs` debe ser positivo: un lockout de 0 o negativo no bloquea nada
// y esconderia una llamada mal construida.
export function lockOut(state: LockoutState, key: string, nowMs: number, durationMs: number): LockoutState {
  if (durationMs <= 0) {
    throw new Error(`lockOut: durationMs debe ser positivo, recibido ${JSON.stringify(durationMs)}`);
  }
  return { lockedUntilByKey: { ...state.lockedUntilByKey, [key]: nowMs + durationMs } };
}

// Limpia el bloqueo de `key` (tras un exito, p.ej.). No-op (misma referencia) si no estaba bloqueada.
export function clearLockout(state: LockoutState, key: string): LockoutState {
  if (!(key in state.lockedUntilByKey)) return state;
  const rest = { ...state.lockedUntilByKey };
  delete rest[key];
  return { lockedUntilByKey: rest };
}
