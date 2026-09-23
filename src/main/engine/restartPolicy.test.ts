import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESTART_POLICY,
  decideRestart,
  type RestartContext,
  type RestartPolicy,
} from './restartPolicy';

// Muerte temprana no intencionada por defecto; cada test cambia solo lo suyo.
function context(overrides: Partial<RestartContext> = {}): RestartContext {
  return { attempt: 0, uptimeMs: 500, exitCode: 1, signal: null, intentional: false, ...overrides };
}

const POLICY: RestartPolicy = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000, healthyUptimeMs: 60_000 };

describe('decideRestart', () => {
  it('decideRestart_intentionalStop_returnsNone', () => {
    const decision = decideRestart(context({ intentional: true }), POLICY);

    expect(decision).toEqual({ action: 'none', reason: expect.stringContaining('proposito') });
  });

  it('decideRestart_firstEarlyCrash_restartsWithBaseDelay', () => {
    const decision = decideRestart(context({ attempt: 0 }), POLICY);

    expect(decision).toEqual({ action: 'restart', delayMs: 1_000, attempt: 1, streakReset: false });
  });

  it('decideRestart_repeatedCrashes_backsOffExponentially', () => {
    const delays = [0, 1, 2].map((attempt) => {
      const decision = decideRestart(context({ attempt }), POLICY);
      return decision.action === 'restart' ? decision.delayMs : null;
    });

    expect(delays).toEqual([1_000, 2_000, 4_000]);
  });

  it('decideRestart_backoffAboveCap_isClampedToMaxDelay', () => {
    // 1000 * 2^6 = 64s, muy por encima del tope de 8s.
    const decision = decideRestart(context({ attempt: 6 }), { ...POLICY, maxAttempts: 99 });

    expect(decision).toMatchObject({ action: 'restart', delayMs: 8_000 });
  });

  it('decideRestart_attemptsExhausted_givesUpWithDetail', () => {
    const decision = decideRestart(context({ attempt: 3, exitCode: 137, signal: 'SIGKILL' }), POLICY);

    expect(decision.action).toBe('give_up');
    if (decision.action !== 'give_up') throw new Error('se esperaba give_up');
    expect(decision.reason).toContain('137');
    expect(decision.reason).toContain('SIGKILL');
    expect(decision.reason).toContain('4 veces'); // attempt 3 consumidos + la muerte actual
  });

  it('decideRestart_healthyProcessDies_resetsTheStreak', () => {
    // Un proceso que vivio mas del umbral no arrastra la racha anterior: reintenta ya, con base.
    const decision = decideRestart(context({ attempt: 3, uptimeMs: 60_000 }), POLICY);

    expect(decision).toEqual({ action: 'restart', delayMs: 1_000, attempt: 1, streakReset: true });
  });

  it('decideRestart_healthyUptimeButIntentional_stillReturnsNone', () => {
    // El orden importa: parar a proposito gana sobre cualquier consideracion de salud.
    const decision = decideRestart(context({ uptimeMs: 999_999, intentional: true }), POLICY);

    expect(decision.action).toBe('none');
  });

  it('decideRestart_exitCodeZeroUnexpected_stillRestarts', () => {
    // Salir con 0 sin que lo pidieramos tambien mata la conversacion: hay que reanudarla. El tope de
    // intentos es lo que evita un bucle si el CLI se cierra siempre al instante.
    const decision = decideRestart(context({ exitCode: 0 }), POLICY);

    expect(decision.action).toBe('restart');
  });

  it('decideRestart_zeroMaxAttempts_givesUpImmediately', () => {
    const decision = decideRestart(context(), { ...POLICY, maxAttempts: 0 });

    expect(decision.action).toBe('give_up');
  });

  it('decideRestart_negativeAttempt_throws', () => {
    expect(() => decideRestart(context({ attempt: -1 }), POLICY)).toThrow(/intento invalido: -1/i);
  });

  it('decideRestart_negativeUptime_throws', () => {
    expect(() => decideRestart(context({ uptimeMs: -5 }), POLICY)).toThrow(/uptime invalido: -5/i);
  });

  it('decideRestart_inconsistentPolicy_throws', () => {
    expect(() => decideRestart(context(), { ...POLICY, maxDelayMs: 10 })).toThrow(/politica de reinicio invalida/i);
    expect(() => decideRestart(context(), { ...POLICY, baseDelayMs: 0 })).toThrow(/politica de reinicio invalida/i);
  });

  it('decideRestart_defaultPolicy_hasSaneShape', () => {
    expect(DEFAULT_RESTART_POLICY.baseDelayMs).toBeLessThan(DEFAULT_RESTART_POLICY.maxDelayMs);
    expect(DEFAULT_RESTART_POLICY.maxAttempts).toBeGreaterThan(0);
    expect(decideRestart(context()).action).toBe('restart');
  });
});
