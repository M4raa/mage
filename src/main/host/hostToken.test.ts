import { describe, expect, it } from 'vitest';
import { challengeProof, createHostToken, tokenMatches, TOKEN_BYTES } from './hostToken';

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

describe('challengeProof', () => {
  it('challengeProof_vectorConocido_devuelveEsteHex', () => {
    const token = 'a'.repeat(64);
    const nonce = '0'.repeat(64);

    const proof = challengeProof(token, nonce);

    expect(proof).toBe('591467ed8fef0c66cd3ab7e445af7bf40833c2afeb582a76836fda4e2eb340ee');
  });

  it('challengeProof_otroNonce_devuelveOtraPrueba', () => {
    const token = 'a'.repeat(64);

    const first = challengeProof(token, '0'.repeat(64));
    const second = challengeProof(token, '1'.repeat(64));

    expect(first).not.toBe(second);
  });

  it('challengeProof_otroToken_devuelveOtraPrueba', () => {
    const nonce = '0'.repeat(64);

    const first = challengeProof('a'.repeat(64), nonce);
    const second = challengeProof('b'.repeat(64), nonce);

    expect(first).not.toBe(second);
  });

  it('challengeProof_tokenVacio_lanzaError', () => {
    expect(() => challengeProof('', '0'.repeat(64))).toThrow('El token del host está vacío');
  });
});
