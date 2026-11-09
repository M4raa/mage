import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { claudeAddArgs, codexAddArgs, mageMcpLaunch, mageMcpServer, type MageMcpLaunch, type MageMcpLaunchInput } from './registration';
import { toClaudeMcpConfig, toCodexOverrides } from '../config/mcpProviderTranslate';

const BASE: MageMcpLaunchInput = {
  isPackaged: true,
  execPath: 'C:/Mage/Mage.exe',
  resourcesPath: 'C:/Mage/resources',
  appPath: 'C:/src/mage',
  appImage: undefined,
  userDataDir: 'C:/Users/u/AppData/Roaming/Mage',
};

describe('mageMcpLaunch', () => {
  it('mageMcpLaunch_appImage_usesAppImageCli', () => {
    const launch = mageMcpLaunch({ ...BASE, appImage: '/home/u/Mage.AppImage' });
    expect(launch).toEqual({ command: '/home/u/Mage.AppImage', args: ['--cli', 'mcp', '--user-data-dir', BASE.userDataDir], env: {} });
  });

  it('mageMcpLaunch_packaged_resourcesCliWithNodeMode', () => {
    const launch = mageMcpLaunch(BASE);
    expect(launch.command).toBe(BASE.execPath);
    expect(launch.args[0]).toBe(join(BASE.resourcesPath, 'cli', 'mage.mjs'));
    expect(launch.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('mageMcpLaunch_dev_scriptsCli', () => {
    const launch = mageMcpLaunch({ ...BASE, isPackaged: false });
    expect(launch.args[0]).toBe(join(BASE.appPath, 'scripts', 'mage-cli', 'mage.mjs'));
  });

  it('mageMcpLaunch_alwaysUserDataDir', () => {
    for (const input of [BASE, { ...BASE, isPackaged: false }, { ...BASE, appImage: '/x.AppImage' }, { ...BASE, appImage: '' }]) {
      expect(mageMcpLaunch(input).args.slice(-3)).toEqual(['mcp', '--user-data-dir', BASE.userDataDir]);
    }
  });
});

describe('add args', () => {
  const launch: MageMcpLaunch = { command: 'node', args: ['cli.mjs', 'mcp'], env: { Z: '1', A: '2' } };

  it('claudeAddArgs_nameBeforeEnvFlags', () => {
    const args = claudeAddArgs(launch);
    expect(args).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'mage', '-e', 'A=2', '-e', 'Z=1', '--', 'node', 'cli.mjs', 'mcp']);
    expect(args.indexOf('mage')).toBeLessThan(args.indexOf('-e'));
  });

  it('codexAddArgs_envFlagsBeforeSeparator', () => {
    const args = codexAddArgs(launch);
    expect(args).toEqual(['mcp', 'add', 'mage', '--env', 'A=2', '--env', 'Z=1', '--', 'node', 'cli.mjs', 'mcp']);
  });

  it('addArgs_noEnv_noFlags', () => {
    const bare: MageMcpLaunch = { command: 'x', args: ['y'], env: {} };
    expect(claudeAddArgs(bare)).not.toContain('-e');
    expect(codexAddArgs(bare)).toEqual(['mcp', 'add', 'mage', '--', 'x', 'y']);
  });
});

describe('mageMcpServer', () => {
  const launch: MageMcpLaunch = { command: 'C:/Mage/Mage.exe', args: ['C:/Mage/resources/cli/mage.mjs', 'mcp', '--user-data-dir', 'C:/perfil'], env: { ELECTRON_RUN_AS_NODE: '1' } };

  it('mageMcpServer_credencial_vaEnElEnvDelServidor', () => {
    const server = mageMcpServer(launch, 'cred-123');

    expect(server).toMatchObject({ name: 'mage', transport: 'stdio', command: launch.command, args: launch.args, env: { ELECTRON_RUN_AS_NODE: '1', MAGE_MCP_CALLER: 'cred-123' } });
  });

  it('mageMcpServer_claude_elFicheroNoLlevaLaCredencial', () => {
    const translated = toClaudeMcpConfig([mageMcpServer(launch, 'cred-123')]);

    expect(JSON.stringify(translated.config)).not.toContain('cred-123');
    expect(Object.values(translated.env)).toContain('cred-123');
  });

  it('mageMcpServer_codex_laCredencialSoloEnElEntorno', () => {
    const overrides = toCodexOverrides([mageMcpServer(launch, 'cred-123')]);

    expect(overrides.args.join(' ')).not.toContain('cred-123');
    expect(overrides.args).toContain('mcp_servers.mage.env_vars=["ELECTRON_RUN_AS_NODE","MAGE_MCP_CALLER"]');
    expect(overrides.env).toMatchObject({ MAGE_MCP_CALLER: 'cred-123' });
  });

  it('mageMcpServer_credencialVacia_lanza', () => {
    expect(() => mageMcpServer(launch, ' ')).toThrow(/vacia/);
  });
});
