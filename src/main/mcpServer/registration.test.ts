import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { claudeAddArgs, codexAddArgs, mageMcpLaunch, type MageMcpLaunch, type MageMcpLaunchInput } from './registration';

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
