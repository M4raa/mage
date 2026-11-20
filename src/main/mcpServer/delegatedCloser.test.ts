import { describe, expect, it, vi } from 'vitest';
import { CLOSE_AFTER_DONE_MS, closeAfterDone, DelegatedCloser } from './delegatedCloser';

const T0 = 1_000_000;

describe('closeAfterDone', () => {
  it('closeAfterDone_keepAlive_nunca', () => {
    expect(closeAfterDone({ onDone: 'keepAlive', finishedAtMs: T0, resultDelivered: true, now: T0 + 10 * CLOSE_AFTER_DONE_MS })).toBe(false);
  });
  it('closeAfterDone_close_antesDe5Min_no', () => {
    expect(closeAfterDone({ onDone: 'close', finishedAtMs: T0, resultDelivered: true, now: T0 + CLOSE_AFTER_DONE_MS - 1 })).toBe(false);
  });
  it('closeAfterDone_close_pasados5Min_si', () => {
    expect(closeAfterDone({ onDone: 'close', finishedAtMs: T0, resultDelivered: true, now: T0 + CLOSE_AFTER_DONE_MS })).toBe(true);
    expect(closeAfterDone({ onDone: 'close', finishedAtMs: T0, resultDelivered: true, now: T0 + 2 * CLOSE_AFTER_DONE_MS })).toBe(true);
  });
  it('closeAfterDone_close_sinResultadoEntregado_no', () => {
    expect(closeAfterDone({ onDone: 'close', finishedAtMs: T0, resultDelivered: false, now: T0 + 10 * CLOSE_AFTER_DONE_MS })).toBe(false);
  });
  it('closeAfterDone_relojAtrasado_no', () => {
    expect(closeAfterDone({ onDone: 'close', finishedAtMs: T0, resultDelivered: true, now: T0 - 1 })).toBe(false);
  });
  it('closeAfterDone_cincoMinutos', () => {
    expect(CLOSE_AFTER_DONE_MS).toBe(300_000);
  });
});

function setup(options: { windowClient?: boolean } = {}) {
  let now = T0;
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const calls: string[] = [];
  const deps = {
    now: () => now,
    // Un temporizador que vence ya no está vivo.
    setTimer: vi.fn((fn: () => void, ms: number) => { const timer = { fn: () => { timer.cancelled = true; fn(); }, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; }),
    retire: vi.fn((id: string) => { calls.push(`retire:${id}`); }),
    close: vi.fn((id: string) => { calls.push(`close:${id}`); }),
    excludeFromKeepAlive: vi.fn(),
    hasWindowClient: vi.fn(() => options.windowClient === true),
    log: vi.fn(),
  };
  const closer = new DelegatedCloser(deps);
  const live = () => timers.filter((timer) => !timer.cancelled);
  const advance = (ms: number) => { now += ms; };
  return { closer, deps, timers, calls, live, advance };
}

describe('DelegatedCloser', () => {
  it('register_close_lasExcluyeDeMantenerLaCache', () => {
    const { closer, deps } = setup();
    closer.register('s1', 'close');
    expect(deps.excludeFromKeepAlive).toHaveBeenCalledWith('s1');
  });
  it('register_keepAlive_noTocaLaCache', () => {
    const { closer, deps } = setup();
    closer.register('s1', 'keepAlive');
    expect(deps.excludeFromKeepAlive).not.toHaveBeenCalled();
  });
  it('turnDone_closeConResultadoEntregado_cierraALos5Min', () => {
    const { closer, calls, live, advance } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    expect(live()).toHaveLength(1);
    expect(live()[0]?.ms).toBe(CLOSE_AFTER_DONE_MS);
    advance(CLOSE_AFTER_DONE_MS);
    live()[0]?.fn();
    expect(calls).toEqual(['retire:s1', 'close:s1']);
  });
  it('turnDone_keepAlive_noProgramaNada', () => {
    const { closer, live } = setup();
    closer.register('s1', 'keepAlive');
    closer.turnDone('s1', true);
    expect(live()).toHaveLength(0);
  });
  it('turnDone_sinResultadoEntregado_noProgramaNada', () => {
    const { closer, live } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', false);
    expect(live()).toHaveLength(0);
  });
  it('turnDone_sesionSinRegistrar_noHaceNada', () => {
    const { closer, live } = setup();
    closer.turnDone('otra', true);
    expect(live()).toHaveLength(0);
  });
  it('cancel_unEnvioAntesDelPlazo_noCierraYSeCuentaDeNuevoAlAcabarElSiguienteTurno', () => {
    const { closer, calls, timers, live, advance } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    advance(60_000);
    closer.cancel('s1');
    expect(live()).toHaveLength(0);
    expect(timers[0]?.cancelled).toBe(true);
    advance(CLOSE_AFTER_DONE_MS);
    expect(calls).toEqual([]);
    closer.turnDone('s1', true);
    expect(live()).toHaveLength(1);
  });
  it('turnDone_otroTurnoAntesDelPlazo_descuentaElAnterior', () => {
    const { closer, timers, live } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    closer.turnDone('s1', true);
    expect(timers).toHaveLength(2);
    expect(timers[0]?.cancelled).toBe(true);
    expect(live()).toHaveLength(1);
  });
  it('forget_cancelaYOlvidaLaPolitica', () => {
    const { closer, live } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    closer.forget('s1');
    expect(live()).toHaveLength(0);
    closer.turnDone('s1', true);
    expect(live()).toHaveLength(0);
  });
  it('closeNow_cierraYaMarcandolaComoTerminada', () => {
    const { closer, calls, live } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    closer.closeNow('s1');
    expect(calls).toEqual(['retire:s1', 'close:s1']);
    expect(live()).toHaveLength(0);
  });
  it('closeNow_tambienEnKeepAlive', () => {
    const { closer, calls } = setup();
    closer.register('s1', 'keepAlive');
    closer.closeNow('s1');
    expect(calls).toEqual(['retire:s1', 'close:s1']);
  });
  it('fire_conUnaVentanaAbierta_noCierraYVuelveAMirarALos5Min', () => {
    const { closer, deps, calls, live, advance } = setup({ windowClient: true });
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    advance(CLOSE_AFTER_DONE_MS);
    live()[0]?.fn();
    expect(calls).toEqual([]);
    expect(live()).toHaveLength(1);
    deps.hasWindowClient.mockReturnValue(false);
    advance(CLOSE_AFTER_DONE_MS);
    live()[0]?.fn();
    expect(calls).toEqual(['retire:s1', 'close:s1']);
  });
  it('fire_elCierreFalla_quedaEnElLogYNoLanza', () => {
    const { closer, deps, live, advance } = setup();
    deps.close.mockImplementation(() => { throw new Error('sesión inexistente'); });
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    advance(CLOSE_AFTER_DONE_MS);
    expect(() => live()[0]?.fn()).not.toThrow();
    expect(deps.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ sessionId: 's1', error: 'sesión inexistente' }));
  });
  it('fire_relojAdelantadoPeroPlazoNoCumplido_noCierra', () => {
    const { closer, calls, live, advance } = setup();
    closer.register('s1', 'close');
    closer.turnDone('s1', true);
    advance(CLOSE_AFTER_DONE_MS - 1);
    live()[0]?.fn();
    expect(calls).toEqual([]);
  });
});
