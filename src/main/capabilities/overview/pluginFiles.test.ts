import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildPluginCatalog,
  parseCatalogStats,
  parseInstalledPlugins,
  parseKnownMarketplaces,
  parseMarketplaceManifest,
  splitPluginId,
} from './pluginFiles';

// Ficheros MEDIDOS con Claude Code 2.1.319 (spike/plugin-cli-spike.mjs), con la raíz desechable reescrita a `/spike`.
const medido = (name: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugin-cli-2.1.319', name), 'utf-8');

const installed = (plugins: Record<string, unknown>): string => JSON.stringify({ version: 2, plugins });

describe('parseInstalledPlugins', () => {
  it('parseInstalledPlugins_formaMedida_idNombreMarketplaceYAmbitos', () => {
    const text = installed({
      'frontend-design@claude-plugins-official': [
        { scope: 'project', version: '2.0.0', projectPath: '/p' },
        { scope: 'user', version: '1.0.0' },
      ],
    });

    const result = parseInstalledPlugins(text, null);

    expect(result.state).toBe('ok');
    expect(result.plugins).toEqual([
      {
        id: 'frontend-design@claude-plugins-official',
        name: 'frontend-design',
        marketplace: 'claude-plugins-official',
        scopes: ['project', 'user'],
        version: '1.0.0',
        enabled: false,
      },
    ]);
  });

  it('parseInstalledPlugins_soloProyecto_sinUser', () => {
    const result = parseInstalledPlugins(installed({ 'a@m': [{ scope: 'project', version: '3.1.0' }] }), null);

    expect(result.plugins[0]?.scopes).toEqual(['project']);
    expect(result.plugins[0]?.version).toBe('3.1.0');
  });

  it('parseInstalledPlugins_activadoEnSettings_enabledTrue', () => {
    const settings = JSON.stringify({ enabledPlugins: { 'a@m': true, 'b@m': false } });

    const result = parseInstalledPlugins(installed({ 'a@m': [{ scope: 'user' }], 'b@m': [{ scope: 'user' }] }), settings);

    expect(result.plugins.map((p) => [p.id, p.enabled])).toEqual([['a@m', true], ['b@m', false]]);
  });

  it('parseInstalledPlugins_ausente_vacio', () => {
    expect(parseInstalledPlugins(null, null)).toEqual({ state: 'absent', plugins: [] });
  });

  it('parseInstalledPlugins_jsonRoto_estadoUnreadable', () => {
    expect(parseInstalledPlugins('{ roto', null)).toEqual({ state: 'unreadable', plugins: [] });
  });

  it('parseInstalledPlugins_settingsConSecretos_noLosDevuelve', () => {
    const settings = JSON.stringify({ env: { TOKEN: 'secreto' }, enabledPlugins: { 'a@m': true } });

    const result = parseInstalledPlugins(installed({ 'a@m': [{ scope: 'user' }] }), settings);

    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('parseInstalledPlugins_medido2_1_319TrasInstalar_deUsuarioYActivado', () => {
    const result = parseInstalledPlugins(medido('installed_plugins.json'), medido('settings-instalado.json'));

    expect(result.plugins).toMatchObject([{ id: 'hola@mage-spike', name: 'hola', marketplace: 'mage-spike', scopes: ['user'], enabled: true }]);
  });

  it('parseInstalledPlugins_medido2_1_319TrasDesactivar_sigueInstaladoYDesactivado', () => {
    const result = parseInstalledPlugins(medido('installed_plugins.json'), medido('settings-desactivado.json'));

    expect(result.plugins).toMatchObject([{ id: 'hola@mage-spike', name: 'hola', marketplace: 'mage-spike', scopes: ['user'], enabled: false }]);
  });
});

describe('splitPluginId', () => {
  it('splitPluginId_sinArroba_marketplaceVacio', () => {
    expect(splitPluginId('solo')).toEqual({ name: 'solo', marketplace: '' });
  });
});

const ABS = resolve('market-dir');

describe('parseKnownMarketplaces', () => {
  it('parseKnownMarketplaces_formaMedida_nombresTipoYUbicacion', () => {
    const text = JSON.stringify({
      zeta: { source: { source: 'github', repo: 'a/b' }, installLocation: ABS, lastUpdated: 'x' },
      alfa: { source: { source: 'directory', path: ABS }, installLocation: ABS },
    });

    const result = parseKnownMarketplaces(text);

    expect(result).toEqual([
      { name: 'alfa', sourceKind: 'directory', installLocation: ABS },
      { name: 'zeta', sourceKind: 'github', installLocation: ABS },
    ]);
  });

  it('parseKnownMarketplaces_ubicacionRelativa_null', () => {
    const text = JSON.stringify({ m: { source: { source: 'git', url: 'u' }, installLocation: 'relativa/x' } });

    expect(parseKnownMarketplaces(text)[0]?.installLocation).toBeNull();
  });
});

describe('parseMarketplaceManifest', () => {
  it('parseMarketplaceManifest_formaMedida_plugins', () => {
    const text = JSON.stringify({
      name: 'm',
      plugins: [{ name: 'p', description: 'd', category: 'dev', author: { name: 'Ana' }, homepage: 'https://x.dev', source: './p' }],
    });

    const result = parseMarketplaceManifest(text);

    expect(result).toEqual({
      state: 'ok',
      entries: [{ name: 'p', description: 'd', category: 'dev', author: 'Ana', homepage: 'https://x.dev' }],
    });
  });

  it('parseMarketplaceManifest_entradaSinNombre_seDescarta', () => {
    const text = JSON.stringify({ plugins: [{ description: 'sin nombre' }, { name: 'ok', description: 'd' }] });

    expect(parseMarketplaceManifest(text).entries.map((e) => e.name)).toEqual(['ok']);
  });

  it('parseMarketplaceManifest_homepageNoHttps_null', () => {
    const text = JSON.stringify({ plugins: [{ name: 'p', description: 'd', homepage: 'http://x.dev' }] });

    expect(parseMarketplaceManifest(text).entries[0]?.homepage).toBeNull();
  });

  it('parseMarketplaceManifest_ausente_estadoAbsent', () => {
    expect(parseMarketplaceManifest(null)).toEqual({ state: 'absent', entries: [] });
  });
});

describe('parseCatalogStats', () => {
  it('parseCatalogStats_formaMedida_instalacionesYSkills', () => {
    const text = JSON.stringify({
      version: 1,
      catalog: { plugins: { 'a@m': { unique_installs: 7, components: { skills: [{ name: 's' }, { name: 't' }] } }, 'b@m': {} } },
    });

    const result = parseCatalogStats(text);

    expect(result.get('a@m')).toEqual({ installs: 7, skills: 2 });
    expect(result.get('b@m')).toEqual({ installs: null, skills: null });
  });

  it('parseCatalogStats_sinCatalogo_vacio', () => {
    expect(parseCatalogStats(null).size).toBe(0);
  });
});

describe('buildPluginCatalog', () => {
  const entry = { name: 'p', description: 'd', category: null, author: null, homepage: null };

  it('buildPluginCatalog_instalado_marcaInstalled', () => {
    const result = buildPluginCatalog({
      marketplaces: [{ name: 'm', sourceKind: 'git', installLocation: ABS }],
      manifests: new Map([['m', { state: 'ok' as const, entries: [entry] }]]),
      stats: new Map([['p@m', { installs: 5, skills: 1 }]]),
      installedIds: new Set(['p@m']),
    });

    expect(result.marketplaces).toEqual([{ name: 'm', sourceKind: 'git', state: 'ok', count: 1 }]);
    expect(result.plugins).toEqual([expect.objectContaining({ id: 'p@m', installed: true, installs: 5, skills: 1 })]);
  });

  it('buildPluginCatalog_marketplaceSinManifiesto_estadoAbsentSinPlugins', () => {
    const result = buildPluginCatalog({
      marketplaces: [{ name: 'm', sourceKind: 'git', installLocation: null }],
      manifests: new Map(),
      stats: new Map(),
      installedIds: new Set(),
    });

    expect(result.marketplaces).toEqual([{ name: 'm', sourceKind: 'git', state: 'absent', count: 0 }]);
    expect(result.plugins).toEqual([]);
  });
});
