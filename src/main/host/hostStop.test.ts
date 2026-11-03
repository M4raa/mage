import { describe, expect, it } from 'vitest';
import type { ConversationSnapshot } from '@shared/coordination';
import { decideStop, hasActiveWork } from './hostStop';

const BASE: ConversationSnapshot = { sessionId: 's1', provider: 'claude', conversationId: 'c1', nativeRef: null, lastSeq: 0, state: 'idle', queue: [], pending: [], background: false };
const snap = (overrides: Partial<ConversationSnapshot>): ConversationSnapshot => ({ ...BASE, ...overrides });

describe('decideStop', () => {
  it('decideStop_conVentana_rechazaPorGui', () => {
    const result = decideStop({ mode: 'gui', force: false, sessions: [] });

    expect(result).toEqual({ outcome: 'refused', reason: 'gui' });
  });

  it('decideStop_conVentanaYForce_rechazaIgual', () => {
    const result = decideStop({ mode: 'gui', force: true, sessions: [snap({ state: 'running' })] });

    expect(result).toEqual({ outcome: 'refused', reason: 'gui' });
  });

  it('decideStop_sinVentanaSinSesiones_seCierra', () => {
    const result = decideStop({ mode: 'headless', force: false, sessions: [] });

    expect(result).toEqual({ outcome: 'stopping' });
  });

  it('decideStop_sinVentanaSoloSesionesIdle_seCierra', () => {
    const result = decideStop({ mode: 'headless', force: false, sessions: [snap({}), snap({ sessionId: 's2' })] });

    expect(result).toEqual({ outcome: 'stopping' });
  });

  it('decideStop_sinVentanaConTurnoEnMarcha_rechazaYLista', () => {
    const sessions = [snap({ state: 'running' }), snap({ sessionId: 's2' })];

    const result = decideStop({ mode: 'headless', force: false, sessions });

    expect(result).toEqual({ outcome: 'refused', reason: 'active', sessions: [{ sessionId: 's1', conversationId: 'c1', provider: 'claude', state: 'running' }] });
  });

  it('decideStop_sinVentanaConTrabajoYForce_seCierra', () => {
    const result = decideStop({ mode: 'headless', force: true, sessions: [snap({ state: 'running' })] });

    expect(result).toEqual({ outcome: 'stopping' });
  });
});

describe('hasActiveWork', () => {
  it.each([
    ['idle', false],
    ['running', true],
    ['requires_action', true],
    ['starting', true],
    ['restarting', true],
    ['error', false],
  ] as const)('hasActiveWork_porEstado_%s', (state, expected) => {
    expect(hasActiveWork(snap({ state }))).toBe(expected);
  });

  it('hasActiveWork_idleConPendiente_true', () => {
    expect(hasActiveWork(snap({ pending: [{ kind: 'permission', request: {} as never }] }))).toBe(true);
  });

  it('hasActiveWork_idleConCola_true', () => {
    expect(hasActiveWork(snap({ queue: [{ id: 'q', text: 't' } as never] }))).toBe(true);
  });
});
