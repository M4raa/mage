import { describe, expect, it } from 'vitest';
import { createHostToken, tokenMatches, TOKEN_BYTES } from './hostToken';

describe('createHostToken', () => {
  it('createHostToken_treintaYDosBytes_sesentaYCuatroHex', () => {
    const token = createHostToken({ randomBytes: (size) => Buffer.alloc(size, 0xab) });

    expect(token).toHaveLength(TOKEN_BYTES * 2);
    expect(token).toBe('ab'.repeat(TOKEN_BYTES));
  });

  it('createHostToken_generadorDevuelveMenosBytes_lanzaConLaCantidad', () => {
    expect(() => createHostToken({ randomBytes: () => Buffer.alloc(8) })).toThrow(/8 bytes/);
  });

  it('createHostToken_dosLlamadasConAleatorioReal_sonDistintas', async () => {
    const { randomBytes } = await import('node:crypto');

    expect(createHostToken({ randomBytes })).not.toBe(createHostToken({ randomBytes }));
  });
});

describe('tokenMatches', () => {
  it('tokenMatches_iguales_true', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true);
  });

  it('tokenMatches_mismoLargoUnCaracterDistinto_false', () => {
    expect(tokenMatches('abc123', 'abc124')).toBe(false);
  });

  it('tokenMatches_largoDistinto_falseSinLanzar', () => {
    expect(tokenMatches('abc123', 'abc12')).toBe(false);
    expect(tokenMatches('abc123', '')).toBe(false);
  });
});
