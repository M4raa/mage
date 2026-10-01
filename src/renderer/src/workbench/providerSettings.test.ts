import { describe, expect, it } from 'vitest';
import type { CustomProvider } from '@shared/providers';
import {
  defaultEffortForProvider,
  defaultModelForProvider,
  effortLevelsForProvider,
  effortSettingKey,
  providerEntries,
} from './models';

// Seccion unificada "Proveedores y modelos" (D2): los helpers puros que la alimentan.

const OLLAMA: CustomProvider = {
  id: 'custom:ollama',
  label: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  hasApiKey: false,
  models: [{ id: 'llama3', label: 'llama3' }],
};

describe('effortLevelsForProvider', () => {
  it('effortLevelsForProvider_claude_devuelveLosCincoNivelesDelCli', () => {
    expect(effortLevelsForProvider('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('effortLevelsForProvider_agy_devuelveLosCuatroQueAceptaSuCli', () => {
    expect(effortLevelsForProvider('agy')).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('effortLevelsForProvider_proveedorPorGateway_noOfreceNinguno', () => {
    expect(effortLevelsForProvider('openai')).toEqual([]);
    expect(effortLevelsForProvider('custom:ollama')).toEqual([]);
  });
});

describe('providerEntries', () => {
  it('providerEntries_sinProveedoresDelUsuario_listaLosDeSerieConSuTipo', () => {
    const entries = providerEntries([]);

    expect(entries.find((entry) => entry.id === 'claude')).toMatchObject({ kind: 'cli', baseUrl: null, custom: false });
    expect(entries.find((entry) => entry.id === 'openai')).toMatchObject({ kind: 'http', custom: false });
  });

  it('providerEntries_conProveedorDelUsuario_loAnadeComoEditable', () => {
    const entry = providerEntries([OLLAMA]).find((candidate) => candidate.id === OLLAMA.id);

    expect(entry).toMatchObject({ kind: 'http', baseUrl: OLLAMA.baseUrl, custom: true, effortLevels: [] });
  });

  it('providerEntries_proveedorDelUsuarioSinModelos_tambienSeLista', () => {
    // A diferencia de `providerOptions` (selectores de conversacion), Configuracion lista TODOS: un
    // proveedor sin modelos es precisamente el que hay que poder arreglar.
    const entries = providerEntries([{ ...OLLAMA, models: [] }]);

    expect(entries.some((entry) => entry.id === OLLAMA.id)).toBe(true);
  });
});

describe('defaultModelForProvider / defaultEffortForProvider', () => {
  const defaults = { claude: 'opus', [effortSettingKey('claude')]: 'high' };

  it('defaultModelForProvider_proveedorConfigurado_devuelveSuModelo', () => {
    expect(defaultModelForProvider(defaults, 'claude')).toBe('opus');
  });

  it('defaultModelForProvider_proveedorSinConfigurar_devuelveVacioQueEsAutomatico', () => {
    expect(defaultModelForProvider(defaults, 'agy')).toBe('');
  });

  it('defaultEffortForProvider_proveedorConfigurado_devuelveSuNivel', () => {
    expect(defaultEffortForProvider(defaults, 'claude')).toBe('high');
  });

  it('defaultEffortForProvider_proveedorSinConfigurar_devuelveVacioQueEsAutomatico', () => {
    expect(defaultEffortForProvider(defaults, 'openai')).toBe('');
  });

  it('defaultModelForProvider_idQueParezcaUnaClaveDeEsfuerzo_noDevuelveElNivel', () => {
    expect(defaultModelForProvider(defaults, effortSettingKey('claude'))).toBe('');
  });
});
