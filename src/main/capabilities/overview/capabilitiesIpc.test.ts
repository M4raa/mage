import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import type { CapabilitiesOverview, InstalledPluginView, PluginCatalogView, SkillFileView } from '@shared/capabilities';
import { registerCapabilitiesIpc } from './capabilitiesIpc';

type Listener = (event: unknown, arg: unknown) => unknown;

const KNOWN = '/a/.claude';

const installedPlugin = (id: string, scopes: InstalledPluginView['scopes']): InstalledPluginView => {
  const [name = '', marketplace = ''] = id.split('@');
  return { id, name, marketplace, scopes, version: null, enabled: true };
};

function setup(plugins: readonly InstalledPluginView[] = []) {
  const handlers = new Map<string, Listener>();
  const overview = vi.fn((accountDir: string) => ({ accountDir, plugins }) as unknown as CapabilitiesOverview);
  const pluginCatalog = vi.fn(
    (): PluginCatalogView => ({ marketplaces: [{ name: 'm', sourceKind: 'git', state: 'ok', count: 1 }], plugins: [] }),
  );
  const runPluginCommand = vi.fn(async () => undefined);
  const skillFile = vi.fn((): SkillFileView => ({ state: 'missing' }));
  registerCapabilitiesIpc({
    handle: (channel, listener) => void handlers.set(channel, listener),
    overview,
    claudeAccountDirs: () => [KNOWN],
    pluginCatalog,
    runPluginCommand,
    skillFile,
  });
  const call = (arg?: unknown): unknown => (handlers.get(IpcChannel.CapabilitiesOverview) as Listener)(null, arg);
  const catalog = (arg?: unknown): unknown => (handlers.get(IpcChannel.CapabilitiesPluginCatalog) as Listener)(null, arg);
  const action = async (arg?: unknown): Promise<unknown> => (handlers.get(IpcChannel.CapabilitiesPluginAction) as Listener)(null, arg);
  const skill = (arg?: unknown): unknown => (handlers.get(IpcChannel.CapabilitiesSkillFile) as Listener)(null, arg);
  return { handlers, overview, runPluginCommand, skillFile, call, catalog, action, skill };
}

const params = (over: Record<string, unknown> = {}) => ({ accountDir: KNOWN, action: 'install', plugin: 'p', marketplace: 'm', ...over });

describe('registerCapabilitiesIpc', () => {
  it('registerCapabilitiesIpc_registraCuatroCanales', () => {
    const { handlers } = setup();

    expect([...handlers.keys()]).toEqual([
      IpcChannel.CapabilitiesOverview,
      IpcChannel.CapabilitiesPluginCatalog,
      IpcChannel.CapabilitiesPluginAction,
      IpcChannel.CapabilitiesSkillFile,
    ]);
  });

  it('capabilitiesSkillFile_valido_llamaAlLector', () => {
    const { skill, skillFile } = setup();
    const arg = { accountDir: KNOWN, name: 'p:s', origin: 'plugin' };

    const result = skill(arg);

    expect(skillFile).toHaveBeenCalledWith(arg);
    expect(result).toEqual({ state: 'missing' });
  });

  it('capabilitiesSkillFile_cuentaDesconocida_lanza', () => {
    const { skill, skillFile } = setup();

    expect(() => skill({ accountDir: '/otra/ruta', name: 's', origin: 'user' })).toThrow('/otra/ruta');
    expect(skillFile).not.toHaveBeenCalled();
  });

  it('capabilitiesSkillFile_nombreConBarra_lanza', () => {
    const { skill, skillFile } = setup();

    expect(() => skill({ accountDir: KNOWN, name: '../x', origin: 'user' })).toThrow('../x');
    expect(skillFile).not.toHaveBeenCalled();
  });

  it('capabilitiesSkillFile_origenRaro_lanza', () => {
    const { skill, skillFile } = setup();

    expect(() => skill({ accountDir: KNOWN, name: 's', origin: 'otro' })).toThrow('otro');
    expect(skillFile).not.toHaveBeenCalled();
  });

  it('capabilitiesOverview_cuentaConocida_llamaAlLector', () => {
    const { call, overview } = setup();

    const result = call(KNOWN);

    expect(overview).toHaveBeenCalledWith(KNOWN);
    expect(result).toEqual({ accountDir: KNOWN, plugins: [] });
  });

  it('capabilitiesOverview_cuentaDesconocida_lanzaConElValor', () => {
    const { call, overview } = setup();

    expect(() => call('/otra/ruta')).toThrow('/otra/ruta');
    expect(overview).not.toHaveBeenCalled();
  });

  it('capabilitiesOverview_noTexto_lanza', () => {
    const { call } = setup();

    expect(() => call(42)).toThrow('42');
  });

  it('pluginCatalog_cuentaDesconocida_lanza', () => {
    const { catalog } = setup();

    expect(() => catalog('/otra/ruta')).toThrow('/otra/ruta');
  });
});

describe('pluginAction', () => {
  it('pluginAction_instalarDeMarketplaceConocido_lanzaElComando', async () => {
    const { action, runPluginCommand } = setup();

    await action(params());

    expect(runPluginCommand).toHaveBeenCalledWith(KNOWN, { engine: 'claude', args: ['plugin', 'install', 'p@m', '--scope', 'user'] });
  });

  it('pluginAction_marketplaceDesconocido_lanzaSinEjecutar', async () => {
    const { action, runPluginCommand } = setup();

    await expect(action(params({ marketplace: 'otro' }))).rejects.toThrow('otro');
    expect(runPluginCommand).not.toHaveBeenCalled();
  });

  it('pluginAction_nombreQueEmpiezaPorGuion_lanza', async () => {
    const { action, runPluginCommand } = setup();

    await expect(action(params({ plugin: '-p' }))).rejects.toThrow('-p');
    expect(runPluginCommand).not.toHaveBeenCalled();
  });

  it('pluginAction_desinstalarSoloDeProyecto_lanza', async () => {
    const { action, runPluginCommand } = setup([installedPlugin('p@m', ['project'])]);

    await expect(action(params({ action: 'uninstall' }))).rejects.toThrow('p@m');
    expect(runPluginCommand).not.toHaveBeenCalled();
  });

  it('pluginAction_desactivarInstaladoPorTi_comandoDisable', async () => {
    const { action, runPluginCommand } = setup([installedPlugin('p@m', ['user', 'project'])]);

    await action(params({ action: 'disable' }));

    expect(runPluginCommand).toHaveBeenCalledWith(KNOWN, { engine: 'claude', args: ['plugin', 'disable', 'p@m', '--scope', 'user'] });
  });
});
