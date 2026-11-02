import { describe, expect, it } from 'vitest';
import type { CapabilityEngine, NativeInstall } from './capabilityPackage';
import { nativeInstallCommands, nativeListCommand, nativeUninstallCommands } from './nativeCommands';

const mcp: NativeInstall = { type: 'mcpStdio', name: 'demo', command: 'node', args: ['server.js', '--flag'] };
const plugin: NativeInstall = { type: 'plugin', name: 'tool', marketplace: { name: 'mk', source: 'owner/repo' } };
const ENGINES: readonly CapabilityEngine[] = ['claude', 'codex'];

describe('nativeInstallCommands', () => {
  it('nativeInstallCommands_claudeMcpStdio_returnsMeasuredArgs', () => {
    // Arrange / Act
    const commands = nativeInstallCommands('claude', mcp);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([
      ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'demo', '--', 'node', 'server.js', '--flag'],
    ]);
  });

  it('nativeInstallCommands_codexMcpStdio_returnsMeasuredArgs', () => {
    // Arrange / Act
    const commands = nativeInstallCommands('codex', mcp);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([['mcp', 'add', 'demo', '--', 'node', 'server.js', '--flag']]);
  });

  it('nativeInstallCommands_claudePlugin_addsMarketplaceThenInstalls', () => {
    // Arrange / Act
    const commands = nativeInstallCommands('claude', plugin);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([
      ['plugin', 'marketplace', 'add', 'owner/repo'],
      ['plugin', 'install', 'tool@mk', '--scope', 'user'],
    ]);
  });

  it('nativeInstallCommands_codexPlugin_addsMarketplaceThenAdds', () => {
    // Arrange / Act
    const commands = nativeInstallCommands('codex', plugin);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([
      ['plugin', 'marketplace', 'add', 'owner/repo'],
      ['plugin', 'add', 'tool@mk'],
    ]);
  });

  it('nativeInstallCommands_mcpArgsStartingWithDash_stayAfterSeparator', () => {
    // Arrange
    const dashed: NativeInstall = { type: 'mcpStdio', name: 'demo', command: 'node', args: ['--port', '1'] };
    // Act / Assert
    for (const engine of ENGINES) {
      const args = nativeInstallCommands(engine, dashed).flatMap((c) => c.args);
      expect(args.indexOf('--port')).toBeGreaterThan(args.indexOf('--'));
    }
  });

  it('nativeInstallCommands_anyEngine_tagsCommandsWithEngine', () => {
    // Arrange / Act / Assert
    for (const engine of ENGINES) {
      const commands = [...nativeInstallCommands(engine, mcp), ...nativeInstallCommands(engine, plugin)];
      expect(commands.every((c) => c.engine === engine)).toBe(true);
    }
  });
});

describe('nativeUninstallCommands', () => {
  it('nativeUninstallCommands_claudeMcpStdio_returnsMeasuredArgs', () => {
    // Arrange / Act
    const commands = nativeUninstallCommands('claude', mcp);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([['mcp', 'remove', 'demo', '--scope', 'user']]);
  });

  it('nativeUninstallCommands_codexMcpStdio_returnsMeasuredArgs', () => {
    // Arrange / Act
    const commands = nativeUninstallCommands('codex', mcp);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([['mcp', 'remove', 'demo']]);
  });

  it('nativeUninstallCommands_claudePlugin_keepsMarketplace', () => {
    // Arrange / Act
    const commands = nativeUninstallCommands('claude', plugin);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([['plugin', 'uninstall', 'tool@mk', '--scope', 'user']]);
  });

  it('nativeUninstallCommands_codexPlugin_keepsMarketplace', () => {
    // Arrange / Act
    const commands = nativeUninstallCommands('codex', plugin);
    // Assert
    expect(commands.map((c) => c.args)).toEqual([['plugin', 'remove', 'tool@mk']]);
  });
});

describe('nativeListCommand', () => {
  it.each([
    ['claude', 'mcpStdio', ['mcp', 'list']],
    ['codex', 'mcpStdio', ['mcp', 'list', '--json']],
    ['claude', 'plugin', ['plugin', 'list', '--json']],
    ['codex', 'plugin', ['plugin', 'list', '--json']],
  ] as const)('nativeListCommand_engineAndType_returnsMeasuredArgs', (engine, type, expected) => {
    // Arrange / Act
    const command = nativeListCommand(engine, type);
    // Assert
    expect(command).toEqual({ engine, args: expected });
  });
});
