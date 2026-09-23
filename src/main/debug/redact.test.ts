import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from './redact';

describe('redact', () => {
  it('redact_primitive_returnsAsIs', () => {
    // Arrange / Act / Assert: primitivos no tienen clave que enmascarar.
    expect(redact('hola')).toBe('hola');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('redact_sensitiveKeys_masksThem', () => {
    // Arrange
    const input = {
      accessToken: 'sk-abc',
      refreshToken: 'rt-xyz',
      oauthAccount: { emailAddress: 'a@b.com' },
      userID: 'u1',
      machineID: 'm1',
      normal: 'visible',
    };

    // Act
    const out = redact(input) as Record<string, unknown>;

    // Assert: los sensibles enmascarados; el resto intacto.
    expect(out.accessToken).toBe(REDACTED);
    expect(out.refreshToken).toBe(REDACTED);
    expect(out.oauthAccount).toBe(REDACTED);
    expect(out.userID).toBe(REDACTED);
    expect(out.machineID).toBe(REDACTED);
    expect(out.normal).toBe('visible');
  });

  it('redact_separatorVariants_masksThem', () => {
    // Arrange: variantes con separadores/mayusculas (api_key, ANTHROPIC_API_KEY, access-token).
    const input = { api_key: 'k', ANTHROPIC_API_KEY: 'k2', 'access-token': 't' };

    // Act
    const out = redact(input) as Record<string, unknown>;

    // Assert
    expect(out.api_key).toBe(REDACTED);
    expect(out.ANTHROPIC_API_KEY).toBe(REDACTED);
    expect(out['access-token']).toBe(REDACTED);
  });

  it('redact_nestedAndArrays_masksDeep', () => {
    // Arrange
    const input = { list: [{ token: 'x', ok: 1 }], nested: { deep: { secret: 's', keep: 2 } } };

    // Act
    const out = redact(input) as { list: Array<Record<string, unknown>>; nested: { deep: Record<string, unknown> } };

    // Assert
    expect(out.list[0]!.token).toBe(REDACTED);
    expect(out.list[0]!.ok).toBe(1);
    expect(out.nested.deep.secret).toBe(REDACTED);
    expect(out.nested.deep.keep).toBe(2);
  });

  it('redact_doesNotMutateInput', () => {
    // Arrange
    const input = { accessToken: 'sk-abc' };

    // Act
    redact(input);

    // Assert: la entrada original se conserva; redact devuelve copia.
    expect(input.accessToken).toBe('sk-abc');
  });

  it('redact_circularReference_doesNotThrow', () => {
    // Arrange: estructura ciclica.
    const input: Record<string, unknown> = { a: 1 };
    input.self = input;

    // Act
    const out = redact(input) as Record<string, unknown>;

    // Assert: el ciclo se corta con un marcador, sin desbordar la pila.
    expect(out.a).toBe(1);
    expect(out.self).toBe('[Circular]');
  });
});
