import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  managedSettingsDir,
  MARKETPLACE_MANIFEST,
  readCapabilitiesOverview,
  readManagedSettings,
  readPluginCatalog,
  type OverviewFs,
} from './capabilitiesOverview';

function memoryFs(files: ReadonlyMap<string, string>): OverviewFs {
  return {
    exists: (path) => files.has(path),
    readFile: (path) => Buffer.from(files.get(path) ?? ''),
    listFiles: (dir) => [...files.keys()].filter((key) => key.startsWith(dir + sep)),
  };
}

const ACCOUNT = join('home', '.claude');
const MANAGED = join('sys', 'managed');

describe('readCapabilitiesOverview', () => {
  it('readCapabilitiesOverview_cuentaConTodo_loJunta', () => {
    const files = new Map([
      [join(ACCOUNT, 'policy-limits.json'), JSON.stringify({ restrictions: { allow_routines: { allowed: true } } })],
      [join(ACCOUNT, 'remote-settings.json'), JSON.stringify({ channelsEnabled: true })],
      [join(ACCOUNT, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'a@m': [{ scope: 'user' }] } })],
      [join(ACCOUNT, 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': true } })],
      [join(MANAGED, 'managed-settings.json'), JSON.stringify({ env: { K: 'v' } })],
    ]);

    const result = readCapabilitiesOverview({ fs: memoryFs(files), managedDir: MANAGED }, ACCOUNT);

    expect(result.accountDir).toBe(ACCOUNT);
    expect(result.policies.restrictions).toEqual([{ name: 'allow_routines', allowed: true }]);
    expect(result.policies.remote).toEqual([{ name: 'channelsEnabled', value: 'true' }]);
    expect(result.plugins.map((p) => [p.id, p.enabled])).toEqual([['a@m', true]]);
    expect(result.managed.files.map((f) => f.file)).toEqual(['managed-settings.json']);
  });

  it('readCapabilitiesOverview_sinFicheros_todoAusente', () => {
    const result = readCapabilitiesOverview({ fs: memoryFs(new Map()), managedDir: MANAGED }, ACCOUNT);

    expect(result.policies.state).toBe('absent');
    expect(result.policies.remoteState).toBe('absent');
    expect(result.pluginsState).toBe('absent');
    expect(result.managed.files).toEqual([]);
  });
});

describe('readPluginCatalog', () => {
  it('readPluginCatalog_marketplaceConManifiesto_susPlugins', () => {
    const market = resolve('vg-market');
    const files = new Map([
      [join(ACCOUNT, 'plugins', 'known_marketplaces.json'), JSON.stringify({ m: { source: { source: 'directory' }, installLocation: market } })],
      [join(market, MARKETPLACE_MANIFEST), JSON.stringify({ plugins: [{ name: 'p', description: 'd' }] })],
      [join(ACCOUNT, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user' }] } })],
    ]);

    const result = readPluginCatalog({ fs: memoryFs(files), managedDir: MANAGED }, ACCOUNT);

    expect(result.marketplaces).toEqual([{ name: 'm', sourceKind: 'directory', state: 'ok', count: 1 }]);
    expect(result.plugins.map((p) => [p.id, p.installed])).toEqual([['p@m', true]]);
  });
});

describe('readManagedSettings', () => {
  it('readManagedSettings_dropIns_soloJsonDelDirectorio', () => {
    const dropIn = join(MANAGED, 'managed-settings.d');
    const files = new Map([
      [join(dropIn, '10-a.json'), '{"a":1}'],
      [join(dropIn, 'notas.txt'), 'x'],
      [join(dropIn, 'sub', '20-b.json'), '{"b":1}'],
    ]);

    const result = readManagedSettings({ fs: memoryFs(files), managedDir: MANAGED });

    expect(result.files.map((f) => f.file)).toEqual([join('managed-settings.d', '10-a.json')]);
  });
});

describe('managedSettingsDir', () => {
  it('managedSettingsDir_windows_programFiles', () => {
    expect(managedSettingsDir('win32', null)).toBe('C:\\Program Files\\ClaudeCode');
  });

  it('managedSettingsDir_macos_librarySupport', () => {
    expect(managedSettingsDir('darwin', null)).toBe('/Library/Application Support/ClaudeCode');
  });

  it('managedSettingsDir_linux_etc', () => {
    expect(managedSettingsDir('linux', null)).toBe('/etc/claude-code');
  });

  it('managedSettingsDir_homeDePrueba_dentroDelHome', () => {
    expect(managedSettingsDir('win32', join('t', 'home'))).toBe(join('t', 'home', 'managed-settings'));
  });
});
