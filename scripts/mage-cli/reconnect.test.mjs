import { describe, expect, it, vi } from 'vitest';
import { NOT_MAGE_SERVER } from './hostLink.mjs';
import { reconnectWithRetries } from './reconnect.mjs';

const delays = (sleep) => sleep.mock.calls.map(([ms]) => ms);

describe('reconnectWithRetries', () => {
  it('reconnect_alSegundoIntento_devuelveElEnlaceYEsperó1y2s', async () => {
    const link = { id: 'nuevo' };
    const sleep = vi.fn(async () => {});
    const connect = vi.fn().mockRejectedValueOnce(new Error('caído')).mockResolvedValueOnce(link);

    const result = await reconnectWithRetries({ connect, sleep, onAttempt: vi.fn() });

    expect(result).toBe(link);
    expect(delays(sleep)).toEqual([1000, 2000]);
  });

  it('reconnect_tresFallos_lanzaConCausa', async () => {
    const sleep = vi.fn(async () => {});
    const last = new Error('tercero');
    const connect = vi.fn().mockRejectedValueOnce(new Error('uno')).mockRejectedValueOnce(new Error('dos')).mockRejectedValueOnce(last);

    const promise = reconnectWithRetries({ connect, sleep, onAttempt: vi.fn() });

    await expect(promise).rejects.toMatchObject({ message: expect.stringContaining('3 intentos'), cause: last });
    expect(delays(sleep)).toEqual([1000, 2000, 4000]);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('reconnect_impostor_noReintenta', async () => {
    const sleep = vi.fn(async () => {});
    const connect = vi.fn().mockRejectedValue(new Error(NOT_MAGE_SERVER));

    await expect(reconnectWithRetries({ connect, sleep, onAttempt: vi.fn() })).rejects.toThrow(NOT_MAGE_SERVER);

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
