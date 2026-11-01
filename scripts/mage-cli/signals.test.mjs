import { describe, expect, it } from 'vitest';
import { decideCtrlC, decideLine, decidePermissionAnswer, isTurnActive } from './signals.mjs';

describe('signals', () => {
  it('decideCtrlC_sinTurno_sale', () => {
    const result = decideCtrlC({ turnActive: false, lastInterruptAt: null }, 1000);

    expect(result.action).toBe('exit');
  });

  it('decideCtrlC_conTurnoPrimeraVez_interrumpeYApuntaLaHora', () => {
    const result = decideCtrlC({ turnActive: true, lastInterruptAt: null }, 1000);

    expect(result).toEqual({ action: 'interrupt', next: { turnActive: true, lastInterruptAt: 1000 } });
  });

  it('decideCtrlC_conTurnoSegundaAntesDe2s_sale', () => {
    const result = decideCtrlC({ turnActive: true, lastInterruptAt: 1000 }, 2999);

    expect(result.action).toBe('exit');
  });

  it('decideCtrlC_conTurnoSegundaA2sJustos_interrumpeOtraVez', () => {
    const result = decideCtrlC({ turnActive: true, lastInterruptAt: 1000 }, 3000);

    expect(result).toEqual({ action: 'interrupt', next: { turnActive: true, lastInterruptAt: 3000 } });
  });

  it('decideCtrlC_noMutaLaEntrada', () => {
    const input = { turnActive: true, lastInterruptAt: null };

    const result = decideCtrlC(input, 500);

    expect(input).toEqual({ turnActive: true, lastInterruptAt: null });
    expect(result.next).not.toBe(input);
  });

  it.each([[Number.NaN], [1.5]])('decideCtrlC_horaNoEntera_lanza (%s)', (nowMs) => {
    expect(() => decideCtrlC({ turnActive: true, lastInterruptAt: null }, nowMs)).toThrow(String(nowMs));
  });

  it.each([
    ['running', true], ['requires_action', true], ['idle', false],
    ['starting', false], ['restarting', false], ['error', false],
  ])('isTurnActive_estados (%s)', (state, expected) => {
    expect(isTurnActive(state)).toBe(expected);
  });

  it.each([
    ['exit', 'exit'], [' salir ', 'exit'], ['/exit', 'exit'],
    ['', 'empty'], ['   ', 'empty'],
    ['hola', 'send'], ['exit ahora', 'send'],
  ])('decideLine_casos (%j)', (text, expected) => {
    expect(decideLine(text)).toBe(expected);
  });

  it.each([
    ['s', 'allow'], ['sí', 'allow'], ['Y', 'allow'], [' yes ', 'allow'],
    ['n', 'deny'], [' NO ', 'deny'],
    ['quizá', null], ['', null],
  ])('decidePermissionAnswer_casos (%j)', (text, expected) => {
    expect(decidePermissionAnswer(text)).toBe(expected);
  });
});
