// Politica de reinicio de una sesion de agente (C1, cierra el [~] de M1.1).
//
// Hasta ahora, si el proceso del CLI moria (crash, OOM, el usuario matandolo, un cierre del CLI tras
// un error de red) la pestana se quedaba con un mensaje de error y la conversacion muerta: para
// seguir, el usuario tenia que cerrar la pestana y abrir otra, perdiendo el hilo. Aqui se decide SI
// se relanza y CUANDO; el relanzado usa `--resume`, asi que la conversacion continua donde estaba.
//
// Modulo PURO: ni timers, ni procesos, ni reloj. Solo la decision.

export interface RestartContext {
  readonly attempt: number; // reinicios ya consumidos en esta racha (0 = primera muerte)
  readonly uptimeMs: number; // cuanto vivio el proceso que acaba de morir
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly intentional: boolean; // lo paramos nosotros (stop()) -> no es un fallo
}

export interface RestartPolicy {
  readonly maxAttempts: number; // reinicios seguidos antes de rendirse
  readonly baseDelayMs: number; // espera del primer reinicio
  readonly maxDelayMs: number; // tope del backoff exponencial
  readonly healthyUptimeMs: number; // vivir esto es "arranco bien" -> la racha se reinicia
}

// Valores por defecto. Backoff 1s -> 2s -> 4s -> 8s -> 16s (tope 30s) y 5 intentos: cubre un crash
// puntual o una caida de red pasajera sin quedarse relanzando eternamente un binario que no arranca.
// Un proceso que aguanta 1 minuto se considera sano: si muere despues, la racha empieza de cero (si
// no, un dia de trabajo con dos crashes espaciados agotaria los intentos).
export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  healthyUptimeMs: 60_000,
};

export type RestartDecision =
  // No hay nada que reiniciar (salida intencionada).
  | { readonly action: 'none'; readonly reason: string }
  // Relanzar tras `delayMs`. `attempt` es el numero de intento que se va a consumir (1-based) y
  // `streakReset` avisa de que la racha anterior se descarto por haber sido un proceso sano.
  | { readonly action: 'restart'; readonly delayMs: number; readonly attempt: number; readonly streakReset: boolean }
  // Agotados los intentos: el consumidor reporta el error y deja la pestana en manos del usuario.
  | { readonly action: 'give_up'; readonly reason: string };

export function decideRestart(
  context: RestartContext,
  policy: RestartPolicy = DEFAULT_RESTART_POLICY,
): RestartDecision {
  assertValid(context, policy);

  if (context.intentional) {
    return { action: 'none', reason: 'la sesion se detuvo a proposito' };
  }
  // Proceso que vivio lo suficiente: la muerte no es un fallo de arranque encadenado, asi que la
  // racha vuelve a empezar y se reintenta ya (con la espera base).
  if (context.uptimeMs >= policy.healthyUptimeMs) {
    return { action: 'restart', delayMs: policy.baseDelayMs, attempt: 1, streakReset: true };
  }
  if (context.attempt >= policy.maxAttempts) {
    return {
      action: 'give_up',
      reason:
        `el proceso murio ${context.attempt + 1} veces seguidas sin llegar a arrancar bien ` +
        `(ultimo cierre: code=${context.exitCode ?? 'none'}, signal=${context.signal ?? 'none'})`,
    };
  }
  return {
    action: 'restart',
    delayMs: backoffDelay(context.attempt, policy),
    attempt: context.attempt + 1,
    streakReset: false,
  };
}

// Backoff exponencial acotado: base * 2^intentos, con tope. Sin jitter a proposito — aqui hay UN
// cliente reintentando contra un proceso local, no una flota golpeando un servicio remoto, asi que el
// jitter solo restaria determinismo a los tests.
function backoffDelay(attempt: number, policy: RestartPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** attempt;
  return Math.min(exponential, policy.maxDelayMs);
}

// Precondiciones explicitas: un contexto o una politica imposibles son un bug del llamador, no un
// caso a tragarse en silencio.
function assertValid(context: RestartContext, policy: RestartPolicy): void {
  if (!Number.isInteger(context.attempt) || context.attempt < 0) {
    throw new Error(`Numero de intento invalido: ${context.attempt}`);
  }
  if (!Number.isFinite(context.uptimeMs) || context.uptimeMs < 0) {
    throw new Error(`Uptime invalido: ${context.uptimeMs}`);
  }
  if (policy.maxAttempts < 0 || policy.baseDelayMs <= 0 || policy.maxDelayMs < policy.baseDelayMs) {
    throw new Error(
      `Politica de reinicio invalida: maxAttempts=${policy.maxAttempts} baseDelayMs=${policy.baseDelayMs} maxDelayMs=${policy.maxDelayMs}`,
    );
  }
}
