import { describe, expect, it } from 'vitest';
import type { HostPairRequestView } from '@shared/hostClients';
import { PairingRefusedError } from './hostErrors';
import { HostPairing, PAIR_TIMEOUT_MS, parseHostPairAnswer } from './hostPairing';

const REQUEST = { clientName: 'mage', clientKind: 'terminal' as const };

function harness(options: { canAsk?: boolean } = {}) {
  const published: (readonly HostPairRequestView[])[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let ids = 0;
  const pairing = new HostPairing({
    canAsk: () => options.canAsk ?? true,
    publish: (pending) => published.push(pending),
    setTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    newId: () => `req-${++ids}`,
  });
  return { pairing, published, timers };
}

const outcome = (promise: Promise<void>) => promise.then(() => 'approved', (err: unknown) => (err instanceof PairingRefusedError ? err.reason : `otro: ${String(err)}`));

describe('HostPairing', () => {
  it('ask_conVentana_publicaLaPeticion', () => {
    const h = harness();

    void h.pairing.ask(REQUEST);

    expect(h.published.at(-1)).toEqual([{ requestId: 'req-1', clientName: 'mage', clientKind: 'terminal' }]);
    expect(h.timers[0]!.ms).toBe(PAIR_TIMEOUT_MS);
  });

  it('answer_autorizar_resuelveYQuitaLaPendiente', async () => {
    const h = harness();
    const result = outcome(h.pairing.ask(REQUEST));

    const handled = h.pairing.answer('req-1', true);

    expect(handled).toBe(true);
    expect(await result).toBe('approved');
    expect(h.published.at(-1)).toEqual([]);
    expect(h.timers[0]!.cancelled).toBe(true);
  });

  it('answer_rechazar_rechazaConMotivoRejected', async () => {
    const h = harness();
    const result = outcome(h.pairing.ask(REQUEST));

    h.pairing.answer('req-1', false);

    expect(await result).toBe('rejected');
  });

  it('plazo_sinRespuesta_rechazaConTimeoutYQuitaLaPendiente', async () => {
    const h = harness();
    const result = outcome(h.pairing.ask(REQUEST));

    h.timers[0]!.fn();

    expect(await result).toBe('timeout');
    expect(h.pairing.pending()).toEqual([]);
  });

  it('answer_trasElPlazo_seIgnora', async () => {
    const h = harness();
    const result = outcome(h.pairing.ask(REQUEST));
    h.timers[0]!.fn();

    expect(h.pairing.answer('req-1', true)).toBe(false);
    expect(await result).toBe('timeout');
  });

  it('ask_sinVentana_rechazaConNoWindowSinPublicar', async () => {
    const h = harness({ canAsk: false });

    expect(await outcome(h.pairing.ask(REQUEST))).toBe('noWindow');
    expect(h.published).toEqual([]);
    expect(h.timers).toEqual([]);
  });

  it('dosPeticiones_seContestanPorSeparado', async () => {
    const h = harness();
    const first = outcome(h.pairing.ask(REQUEST));
    const second = outcome(h.pairing.ask({ clientName: 'otro', clientKind: 'widget' }));

    h.pairing.answer('req-2', true);

    expect(await second).toBe('approved');
    expect(h.pairing.pending().map((p) => p.requestId)).toEqual(['req-1']);
    h.pairing.answer('req-1', false);
    expect(await first).toBe('rejected');
  });

  it('answer_idDesconocido_false', () => {
    const h = harness();

    expect(h.pairing.answer('nada', true)).toBe(false);
  });
});

describe('parseHostPairAnswer', () => {
  it('parseHostPairAnswer_valida_laDevuelve', () => {
    expect(parseHostPairAnswer({ requestId: 'r', approve: true })).toEqual({ requestId: 'r', approve: true });
  });

  it('parseHostPairAnswer_invalida_lanzaConElValor', () => {
    expect(() => parseHostPairAnswer({ requestId: 'r', approve: 'sí' })).toThrow(/"approve":"sí"/);
    expect(() => parseHostPairAnswer({ requestId: '', approve: true })).toThrow();
    expect(() => parseHostPairAnswer(null)).toThrow(/null/);
    expect(() => parseHostPairAnswer({ requestId: 'r', approve: true, extra: 1 })).toThrow();
  });
});
