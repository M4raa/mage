import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import type { AppSettings } from '@shared/settings';
import { SettingsStore, type SettingsStoreDeps } from './settingsStore';

const VALID: AppSettings = {
  version: 1,
  notificationRules: [{ id: 'r1', label: 'Deploy', pattern: 'deploy (ok|listo)', enabled: true }],
  theme: 'light',
  widgetEnabled: true,
  backgroundOpacity: 80,
  importedThemes: [{ id: 'ovsx:acme.dark', label: 'Acme Dark', type: 'dark', tokens: { '--color-mg-window': '#101010' } }],
  activeThemeId: 'ovsx:acme.dark',
  defaultModelByProvider: { claude: 'opus', gemini: 'gemini-2.5-pro' },
  defaultPermissionMode: 'auto',
  keybindingOverrides: [{ actionId: 'app.toggleSidebar', keys: 'CmdOrCtrl+Shift+B' }],
  customProviders: [
    { id: 'custom:ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', hasApiKey: false, models: [{ id: 'llama3', label: 'llama3' }] },
  ],
  trustedFolders: ['C:/sourcecode/mage'],
  scratchRetention: '30d',
  closeBehavior: 'background',
  newConversationFolder: 'lastProject',
  onboardingCompletedVersion: 1,
  uiScale: 110,
  defaultProvider: 'claude',
  accentByAccount: { 'C:/Users/u/.claude-p': 3 },
};

function deps(overrides: Partial<SettingsStoreDeps> = {}): SettingsStoreDeps {
  return {
    filePath: '/data/app-settings.json',
    exists: () => true,
    readFile: () => JSON.stringify(VALID),
    writeFile: vi.fn(),
    rename: vi.fn(),
    tempSuffix: () => 'suf',
    ...overrides,
  };
}

describe('SettingsStore.load', () => {
  it('load_accentByAccountFueraDeRango_caeAVacio', () => {
    // PERS-3: un indice que no es un acento del tema no se pinta; la cuenta vuelve al de su posicion.
    const file = JSON.stringify({ ...VALID, accentByAccount: { 'C:/Users/u/.claude-p': 9 } });

    expect(new SettingsStore(deps({ readFile: () => file })).load().accentByAccount).toEqual({});
  });

  it('load_sinAccentByAccount_caeAVacio', () => {
    const { accentByAccount: _ausente, ...previo } = VALID;

    expect(new SettingsStore(deps({ readFile: () => JSON.stringify(previo) })).load().accentByAccount).toEqual({});
  });

  it('load_ficheroValido_devuelveLaConfiguracion', () => {
    expect(new SettingsStore(deps()).load()).toEqual(VALID);
  });

  it('load_ficheroAusente_devuelveDefaults', () => {
    const store = new SettingsStore(deps({ exists: () => false }));

    expect(store.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('load_jsonCorrupto_devuelveDefaults', () => {
    const store = new SettingsStore(deps({ readFile: () => '{no es json' }));

    expect(store.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('load_formaInvalida_devuelveDefaults', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 'x', notificationRules: 3 }) }));

    expect(store.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('load_camposExtra_losIgnoraYDevuelveLoConocido', () => {
    const withExtra = { ...VALID, futuro: true };
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify(withExtra) }));

    expect(store.load()).toEqual(VALID);
  });

  it('load_sinTheme_caeADark', () => {
    // Fichero antiguo (sin la clave theme): .catch rellena 'dark' sin invalidar el resto.
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [] }) }));

    expect(store.load().theme).toBe('dark');
  });

  it('load_themeInvalido_caeADark', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'neon' }) }));

    expect(store.load().theme).toBe('dark');
  });

  it('load_themeValido_seConserva', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'system' }) }));

    expect(store.load().theme).toBe('system');
  });

  it('load_modoPorDefectoValido_seConserva', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ ...VALID, defaultPermissionMode: 'plan' }) }));

    expect(store.load().defaultPermissionMode).toBe('plan');
  });

  it('load_modoPorDefectoOmitirPermisos_seConserva', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ ...VALID, defaultPermissionMode: 'bypassPermissions' }) }));

    expect(store.load().defaultPermissionMode).toBe('bypassPermissions');
  });

  it('load_modoPorDefectoInvalidoOAusente_caeAVacio', () => {
    for (const bad of ['dontAsk', 7, null]) {
      const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ ...VALID, defaultPermissionMode: bad }) }));

      expect(store.load().defaultPermissionMode).toBe('');
    }
    const { defaultPermissionMode: _omitted, ...withoutMode } = VALID;
    expect(new SettingsStore(deps({ readFile: () => JSON.stringify(withoutMode) })).load().defaultPermissionMode).toBe('');
  });

  it('load_sinWidgetEnabled_caeAFalse', () => {
    // Fichero antiguo (sin la clave widgetEnabled): .catch rellena false sin invalidar el resto.
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark' }) }));

    expect(store.load().widgetEnabled).toBe(false);
  });

  it('load_widgetEnabledValido_seConserva', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', widgetEnabled: true }) }));

    expect(store.load().widgetEnabled).toBe(true);
  });

  it('load_sinTemasImportados_caeAVaciosYNull', () => {
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark' }) }));

    const loaded = store.load();
    expect(loaded.importedThemes).toEqual([]);
    expect(loaded.activeThemeId).toBeNull();
  });

  it('load_temaImportadoValido_seConserva', () => {
    const imported = { id: 'ovsx:acme.dark', label: 'Acme Dark', type: 'dark', tokens: { '--color-mg-window': '#101010' } };
    const store = new SettingsStore(
      deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', importedThemes: [imported], activeThemeId: 'ovsx:acme.dark' }) }),
    );

    const loaded = store.load();
    expect(loaded.importedThemes).toEqual([imported]);
    expect(loaded.activeThemeId).toBe('ovsx:acme.dark');
  });

  it('load_temaImportadoConTokenColors_losConserva', () => {
    const imported = {
      id: 'ovsx:acme.dark',
      label: 'Acme Dark',
      type: 'dark',
      tokens: {},
      tokenColors: [{ scope: ['comment'], settings: { foreground: '#6a9955', fontStyle: 'italic' } }],
    };
    const store = new SettingsStore(
      deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', importedThemes: [imported] }) }),
    );

    expect(store.load().importedThemes[0]?.tokenColors).toEqual(imported.tokenColors);
  });

  it('load_tokenColorsInvalidos_conservaElTemaSinEllos', () => {
    // Solo se pierde el resaltado del codigo (cae al tema base); el tema importado sigue aplicandose.
    const imported = { id: 'ovsx:acme.dark', label: 'Acme Dark', type: 'dark', tokens: {}, tokenColors: 'no-es-un-array' };
    const store = new SettingsStore(
      deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', importedThemes: [imported] }) }),
    );

    const loaded = store.load();
    expect(loaded.importedThemes).toHaveLength(1);
    expect(loaded.importedThemes[0]?.tokenColors).toBeUndefined();
  });

  it('load_sinKeybindingOverrides_caeAVacio', () => {
    // Fichero de una version anterior a D5 (sin la clave): .catch rellena [] sin invalidar el resto.
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark' }) }));

    expect(store.load().keybindingOverrides).toEqual([]);
  });

  it('load_keybindingOverrideValido_seConserva', () => {
    const override = { actionId: 'app.openSettings', keys: 'CmdOrCtrl+K' };
    const store = new SettingsStore(
      deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', keybindingOverrides: [override] }) }),
    );

    expect(store.load().keybindingOverrides).toEqual([override]);
  });

  it('load_keybindingOverridesFormaInvalida_caeAVacio', () => {
    // Un item sin `keys` rompe el esquema del array entero (mismo patron que importedThemes): cae a [].
    const store = new SettingsStore(
      deps({
        readFile: () =>
          JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', keybindingOverrides: [{ actionId: 'x' }] }),
      }),
    );

    expect(store.load().keybindingOverrides).toEqual([]);
  });

  it('load_keybindingOverrideConActionIdYaInexistente_seConservaTalCual', () => {
    // La resolucion (renderer) es quien decide ignorarlo; el store solo valida FORMA, no semantica.
    const override = { actionId: 'accion.eliminada.en.una.version.futura', keys: 'CmdOrCtrl+Z' };
    const store = new SettingsStore(
      deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', keybindingOverrides: [override] }) }),
    );

    expect(store.load().keybindingOverrides).toEqual([override]);
  });

  it('load_sinCustomProviders_caeAVacio', () => {
    // Fichero escrito antes de E2 (sin la clave): .catch rellena [] y el resto de la config sobrevive,
    // asi que no hace falta subir APP_SETTINGS_VERSION.
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark' }) }));

    expect(store.load().customProviders).toEqual([]);
    expect(store.load().theme).toBe('dark');
  });

  it('load_customProviderValido_seConserva', () => {
    const provider = {
      id: 'custom:lm-studio',
      label: 'LM Studio',
      baseUrl: 'http://192.168.1.9:1234/v1',
      hasApiKey: true,
      models: [{ id: 'local-model', label: 'Local' }],
    };
    const store = new SettingsStore(
      deps({ readFile: () => JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', customProviders: [provider] }) }),
    );

    expect(store.load().customProviders).toEqual([provider]);
  });

  it('load_customProviderFormaInvalida_caeAVacio', () => {
    // Un proveedor sin baseUrl rompe el array entero (mismo patron que importedThemes): cae a [].
    const store = new SettingsStore(
      deps({
        readFile: () =>
          JSON.stringify({ version: 1, notificationRules: [], theme: 'dark', customProviders: [{ id: 'x', label: 'X', models: [] }] }),
      }),
    );

    expect(store.load().customProviders).toEqual([]);
  });
});

describe('SettingsStore.save', () => {
  it('save_estadoValido_escribeTmpYRenombra', () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    new SettingsStore(deps({ writeFile, rename })).save(VALID);

    expect(writeFile).toHaveBeenCalledWith('/data/app-settings.json.suf.tmp', JSON.stringify(VALID, null, 2));
    expect(rename).toHaveBeenCalledWith('/data/app-settings.json.suf.tmp', '/data/app-settings.json');
  });

  it('save_dosEscriturasConcurrentes_usanTemporalesDistintos', () => {
    const writes: string[] = [];
    let call = 0;
    const store = (): SettingsStore =>
      new SettingsStore(deps({ tempSuffix: () => `uuid-${++call}`, writeFile: (path) => writes.push(path) }));

    store().save(VALID);
    store().save(VALID);

    expect(new Set(writes).size).toBe(2);
  });

  it('save_estadoInvalido_lanzaSinEscribir', () => {
    const writeFile = vi.fn();
    const store = new SettingsStore(deps({ writeFile }));

    expect(() => store.save({ version: 1, notificationRules: [{ id: '' }] } as unknown as AppSettings)).toThrow(/invalida/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
