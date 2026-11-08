import { describe, expect, it, vi } from 'vitest';
import { MagePolicyError, MageValidationError } from './errors';
import { canonicalFingerprint, MemoryIdempotencyStore } from './idempotencyStore';

const request = (requestId: string, fingerprint = 'same') => ({ namespace: 'create:scope', requestId, fingerprint });

describe('MemoryIdempotencyStore', () => {
  it.each([0, -1, NaN, 1.5])('constructor_capacidadInvalida_rechaza_%s', (capacity) => {
    expect(() => new MemoryIdempotencyStore(capacity)).toThrow(`valor recibido ${capacity}`);
  });
  it('execute_concurrenciaCompartePromise_efectoUnico', async () => {
    const store = new MemoryIdempotencyStore();
    const effect = vi.fn(async () => 'result');
    const first = store.execute(request('1'), effect);
    const second = store.execute(request('1'), effect);
    expect(second).toBe(first);
    expect(await first).toBe('result');
    expect(await store.execute(request('1'), effect)).toBe('result');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(() => store.execute(request('1', 'different'), effect)).toThrow('idempotency_conflict: requestId 1');
  });
  it('execute_capacidadDos_expulsaCompletadaFIFO', async () => {
    const store = new MemoryIdempotencyStore(2);
    const effect = vi.fn(async () => 'ok');
    await store.execute(request('1'), effect);
    await store.execute(request('2'), effect);
    await store.execute(request('3'), effect);
    await store.execute(request('2'), effect);
    expect(effect).toHaveBeenCalledTimes(3);
    await store.execute(request('1'), effect);
    expect(effect).toHaveBeenCalledTimes(4);
  });
  it('execute_pendienteConCompletada_noExpulsaPendiente', async () => {
    const store = new MemoryIdempotencyStore(2);
    let resolve!: (value: string) => void;
    const effect = () => new Promise<string>((done) => { resolve = done; });
    const pending = store.execute(request('1'), effect);
    await store.execute(request('2'), async () => 'done');
    await store.execute(request('3'), async () => 'another');
    expect(store.execute(request('1'), effect)).toBe(pending);
    resolve('released');
    await pending;
  });
  it('execute_todoPendiente_rechazaCapacidad', async () => {
    const store = new MemoryIdempotencyStore(2);
    const releases: (() => void)[] = [];
    const effect = () => new Promise<void>((resolve) => releases.push(resolve));
    const promises = [store.execute(request('1'), effect), store.execute(request('2'), effect)];
    expect(() => store.execute(request('3'), effect)).toThrow('idempotency_capacity: capacidad 2');
    await Promise.resolve();
    releases.forEach((resolve) => resolve());
    await Promise.all(promises);
  });
  it('execute_falloConservado_noRepiteEfecto', async () => {
    const store = new MemoryIdempotencyStore();
    const effect = vi.fn(async () => { throw new Error('failure'); });
    const failed = store.execute(request('1'), effect);
    await expect(failed).rejects.toThrow('failure');
    expect(store.execute(request('1'), effect)).toBe(failed);
    await expect(failed).rejects.toThrow('failure');
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it('execute_rechazoDeValidacion_mismoIdSePuedeReintentar', async () => {
    const store = new MemoryIdempotencyStore();
    await expect(store.execute(request('1', 'a'), async () => { throw new MageValidationError('invalid_model: x'); })).rejects.toThrow('invalid_model');
    const effect = vi.fn(async () => 'ok');

    await expect(store.execute(request('1', 'otra'), effect)).resolves.toBe('ok');

    expect(effect).toHaveBeenCalledTimes(1);
  });
  it('execute_rechazoComun_elIdSigueGastado', async () => {
    const store = new MemoryIdempotencyStore();
    await expect(store.execute(request('1', 'a'), async () => { throw new MagePolicyError('launch_failed: x'); })).rejects.toThrow('launch_failed');

    expect(() => store.execute(request('1', 'otra'), async () => 'ok')).toThrow('idempotency_conflict: requestId 1');
  });
  it('execute_rechazoDeValidacion_mismaHuellaReintentaElEfecto', async () => {
    const store = new MemoryIdempotencyStore();
    await expect(store.execute(request('1'), async () => { throw new MageValidationError('invalid_effort: x'); })).rejects.toThrow('invalid_effort');
    const effect = vi.fn(async () => 'ok');

    await expect(store.execute(request('1'), effect)).resolves.toBe('ok');

    expect(effect).toHaveBeenCalledTimes(1);
  });
  it('canonicalFingerprint_propiedadesReordenadas_mismaHuella', () => {
    expect(canonicalFingerprint({ a: 1, b: { z: 3, x: 2 } })).toBe(canonicalFingerprint({ b: { x: 2, z: 3 }, a: 1 }));
    expect(canonicalFingerprint({ prompt: 'one' })).not.toBe(canonicalFingerprint({ prompt: 'two' }));
  });
});
