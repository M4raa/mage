import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import type { CustomProvider } from '@shared/providers';
import {
  migrateLegacyProviderKeys,
  parseApiKeySetParams,
  parseProviderId,
  providerApiKeySecretId,
  withApiKeyFlags,
  type ProviderKeyVault,
} from './providerSecrets';

function memoryVault(initial: Record<string, string> = {}): ProviderKeyVault & { readonly entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    set: (id, value) => void entries.set(id, value),
    get: (id) => entries.get(id) ?? null,
    has: (id) => entries.has(id),
  };
}

function provider(id: string, overrides: Partial<CustomProvider> = {}): CustomProvider {
  return { id, label: id, baseUrl: 'http://localhost:11434/v1', hasApiKey: false, models: [], ...overrides };
}

describe('withApiKeyFlags', () => {
  it('withApiKeyFlags_mandaLaBovedaSobreElFichero', () => {
    const vault = memoryVault({ [providerApiKeySecretId('custom:a')]: 'sk-centinela-boveda' });
    const settings = { ...DEFAULT_APP_SETTINGS, customProviders: [provider('custom:a'), provider('custom:b', { hasApiKey: true })] };

    const flagged = withApiKeyFlags(settings, vault);

    expect(flagged.customProviders.map((p) => p.hasApiKey)).toEqual([true, false]);
    expect(JSON.stringify(flagged)).not.toContain('sk-centinela-boveda');
  });
});

describe('parseApiKeySetParams', () => {
  it('parseApiKeySetParams_valido_devuelveIdYClaveRecortada', () => {
    expect(parseApiKeySetParams({ providerId: 'custom:a', apiKey: '  sk  ' })).toEqual({ providerId: 'custom:a', apiKey: 'sk' });
  });

  it('parseApiKeySetParams_proveedorDeSerie_lanza', () => {
    expect(() => parseApiKeySetParams({ providerId: 'openai', apiKey: 'sk' })).toThrow(/providerId/);
  });

  it('parseApiKeySetParams_claveVacia_lanzaSinCitarElValor', () => {
    expect(() => parseApiKeySetParams({ providerId: 'custom:a', apiKey: '   ' })).toThrow(/apiKey/);
  });

  it('parseApiKeySetParams_null_lanza', () => {
    expect(() => parseApiKeySetParams(null)).toThrow(/invalida/);
  });
});

describe('parseProviderId', () => {
  it('parseProviderId_noEsDelUsuario_lanzaConElValor', () => {
    expect(() => parseProviderId('claude')).toThrow(/"claude"/);
    expect(parseProviderId('custom:a')).toBe('custom:a');
  });
});

describe('migrateLegacyProviderKeys', () => {
  it('migrateLegacyProviderKeys_clavesEnClaro_lasPasaALaBovedaYCuentaLasMovidas', () => {
    const vault = memoryVault();
    const raw = JSON.stringify({
      customProviders: [
        { id: 'custom:a', apiKey: ' sk-a ' },
        { id: 'custom:local', apiKey: '' },
        { id: 'custom:nuevo', hasApiKey: false },
      ],
    });

    const moved = migrateLegacyProviderKeys(raw, vault);

    expect(moved).toBe(1);
    expect(vault.get(providerApiKeySecretId('custom:a'))).toBe('sk-a');
    expect(vault.entries.size).toBe(1);
  });

  it('migrateLegacyProviderKeys_sinFichero_noHaceNada', () => {
    expect(migrateLegacyProviderKeys(null, memoryVault())).toBe(0);
  });

  it('migrateLegacyProviderKeys_jsonRoto_noHaceNada', () => {
    expect(migrateLegacyProviderKeys('{ roto', memoryVault())).toBe(0);
  });

  it('migrateLegacyProviderKeys_sinProveedores_noHaceNada', () => {
    expect(migrateLegacyProviderKeys(JSON.stringify({ version: 1 }), memoryVault())).toBe(0);
  });

  it('migrateLegacyProviderKeys_bovedaSinCifrado_propagaElError', () => {
    // Quien llama NO reescribe el fichero si esto lanza: las claves se quedan donde estaban.
    const vault: ProviderKeyVault = {
      set: () => {
        throw new Error('sin cifrado');
      },
      get: () => null,
      has: () => false,
    };

    expect(() => migrateLegacyProviderKeys(JSON.stringify({ customProviders: [{ id: 'custom:a', apiKey: 'sk' }] }), vault)).toThrow('sin cifrado');
  });
});
