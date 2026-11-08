import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import { librarySecretId, SECRET_MAX_CHARS, validateLibrarySecrets } from './librarySecrets';

const KEY = { packageId: 'exa-mcp', engine: 'claude' as const, accountDir: resolve('/Users/Ana/.claude') };

describe('librarySecretId', () => {
  it('librarySecretId_mayusculasWindows_mismoId', () => {
    // Arrange
    const lower = { ...KEY, accountDir: resolve('/users/ana/.claude') };
    // Act / Assert
    expect(librarySecretId(KEY, 'EXA_API_KEY', true)).toBe(librarySecretId(lower, 'EXA_API_KEY', true));
    expect(librarySecretId(KEY, 'EXA_API_KEY', false)).not.toBe(librarySecretId(lower, 'EXA_API_KEY', false));
  });

  it('librarySecretId_cuentaOMotorDistinto_idDistinto', () => {
    // Arrange
    const other = { ...KEY, accountDir: resolve('/Users/Ana/.claude-b') };
    // Act / Assert
    expect(librarySecretId(other, 'N', false)).not.toBe(librarySecretId(KEY, 'N', false));
    expect(librarySecretId({ ...KEY, engine: 'codex' }, 'N', false)).not.toBe(librarySecretId(KEY, 'N', false));
    expect(librarySecretId(KEY, 'N', false)).toMatch(/^library\|claude\|[0-9a-f]{16}\|exa-mcp\|N$/);
  });
});

describe('validateLibrarySecrets', () => {
  it('validateLibrarySecrets_valorConEspacios_devuelveRecortado', () => {
    expect(validateLibrarySecrets(['A_KEY'], { A_KEY: '  abc \n' }, 'p')).toEqual({ A_KEY: 'abc' });
  });

  it('validateLibrarySecrets_valorLargo_error', () => {
    // Arrange
    const given = { A_KEY: 'x'.repeat(SECRET_MAX_CHARS + 1) };
    // Act
    const act = (): unknown => validateLibrarySecrets(['A_KEY'], given, 'p');
    // Assert
    expect(act).toThrow(UserFacingError);
    expect(act).not.toThrow(/xxxxx/);
  });

  it('validateLibrarySecrets_nombreInvalido_error', () => {
    expect(() => validateLibrarySecrets(['a_key'], { a_key: 'v' }, 'p')).toThrow(UserFacingError);
  });

  it.each([[undefined], [{}], [{ A_KEY: '' }], [{ A_KEY: 'v', B: 'w' }], [{ B: 'w' }]])('validateLibrarySecrets_faltaOSobra_error', (given) => {
    expect(() => validateLibrarySecrets(['A_KEY'], given, 'p')).toThrow(UserFacingError);
  });
});
