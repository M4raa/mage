import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import type { AppSettings } from '@shared/settings';
import { SettingsStore, type SettingsStoreDeps } from './settingsStore';

const VALID: AppSettings = {
  version: 1,
  notificationRules: [{ id: 'r1', label: 'Deploy', pattern: 'deploy (ok|listo)', enabled: true }],
  chatProjects: [],
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
  lastSeenReleaseNotesVersion: '0.1.1',
  uiScale: 110,
  defaultProvider: 'claude',
  accentByAccount: { 'C:/Users/u/.claude-p': 3 },
  claudeAiConnectorsOff: ['C:/Users/u/.claude-p'],
  ghNoticeDismissed: true,
  autoArchiveOnPrClose: true,
  agyCommandRules: { allow: ['git status'], deny: ['rm -rf build'] },
  agyLinkedPaths: ['.aws'],
  runtimeShell: 'powershell',
  runtimeToolAccess: { 'custom:lm': [{ model: '*', allow: null, deny: ['Bash'] }] },
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
  it('load_sinCamposDeAgy_caeANingunaReglaYNingunaCarpeta', () => {
    // Un fichero de antes de la fase 2 del grupo E no los trae: no se concede nada ni se enlaza nada extra.
    const { agyCommandRules: _reglas, agyLinkedPaths: _rutas, ...previo } = VALID;

    const loaded = new SettingsStore(deps({ readFile: () => JSON.stringify(previo) })).load();

    expect(loaded.agyCommandRules).toEqual({ allow: [], deny: [] });
    expect(loaded.agyLinkedPaths).toEqual([]);
  });

  it('load_runtimeShellAusenteOInvalido_caeAAuto', () => {
    // Un fichero de antes de P-032 no lo trae; uno editado a mano puede traer cualquier cosa.
    const { runtimeShell: _shell, ...previo } = VALID;

    const sinCampo = new SettingsStore(deps({ readFile: () => JSON.stringify(previo) })).load();
    const invalido = new SettingsStore(deps({ readFile: () => JSON.stringify({ ...VALID, runtimeShell: 'cmd' }) })).load();

    expect([sinCampo.runtimeShell, invalido.runtimeShell]).toEqual(['auto', 'auto']);
  });

  it('load_accentByAccountFueraDeRango_caeAVacio', () => {
    // PERS-3: un indice que no es un acento del tema no se pinta; la cuenta vuelve al de su posicion.
    const file = JSON.stringify({ ...VALID, accentByAccount: { 'C:/Users/u/.claude-p': 9 } });

    expect(new SettingsStore(deps({ readFile: () => file })).load().accentByAccount).toEqual({});
  });

  it('load_sinLastSeenReleaseNotesVersion_caeAVacio', () => {
    // Un fichero de la 0.1.0/0.1.1 no trae el campo: '' es «nunca se guardo».
    const { lastSeenReleaseNotesVersion: _ausente, ...previo } = VALID;

    expect(new SettingsStore(deps({ readFile: () => JSON.stringify(previo) })).load().lastSeenReleaseNotesVersion).toBe('');
  });

  it('load_lastSeenReleaseNotesVersionNoTexto_caeAVacio', () => {
    const file = JSON.stringify({ ...VALID, lastSeenReleaseNotesVersion: 12 });

    expect(new SettingsStore(deps({ readFile: () => file })).load().lastSeenReleaseNotesVersion).toBe('');
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

  it('load_proyectosPersistidosConReglasYAplicacion', () => {
    const project = { id: 'p1', name: 'Python', instructions: 'Experto en Python', cwd: 'C:/apps/Python', sessionIds: ['s1'] };
    const store = new SettingsStore(deps({ readFile: () => JSON.stringify({ ...VALID, chatProjects: [project] }) }));
    expect(store.load().chatProjects).toEqual([project]);
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

  it('load_customProviderConVentanaYHerramientas_lasConservaYDescartaLasRaras', () => {
    // P-032 R5: opcionales; un valor raro se descarta sin tirar el proveedor.
    const base = { id: 'custom:lm', label: 'LM', baseUrl: 'http://h:1/v1', hasApiKey: false, models: [] };
    const store = new SettingsStore(
      deps({
        readFile: () =>
          JSON.stringify({ version: 1, notificationRules: [], customProviders: [{ ...base, contextWindow: 8192, supportsTools: false }, { ...base, id: 'custom:b', contextWindow: -1, supportsTools: 'si' }] }),
      }),
    );

    const [first, second] = store.load().customProviders;

    expect(first).toMatchObject({ contextWindow: 8192, supportsTools: false });
    expect(second?.contextWindow).toBeUndefined();
    expect(second?.supportsTools).toBeUndefined();
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
