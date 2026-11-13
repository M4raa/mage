import { describe, expect, it } from 'vitest';
import { parseInstalledPlugins, splitPluginId } from './pluginFiles';

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
});

describe('splitPluginId', () => {
  it('splitPluginId_sinArroba_marketplaceVacio', () => {
    expect(splitPluginId('solo')).toEqual({ name: 'solo', marketplace: '' });
  });
});
