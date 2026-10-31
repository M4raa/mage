import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BLOCKED_AGENT_ENV_VARS } from '../os/agentEnv';
import type { CommandRunner } from './commandRunner';
import type { NativeCommand } from './nativeCommands';
import {
  NATIVE_COMMAND_TIMEOUT_MS,
  NativeCommandError,
  runNativeCommand,
  runNativeCommands,
  type NativeRunContext,
} from './nativeRunner';

const configDir = resolve('/cuentas/claude-a');
const command: NativeCommand = { engine: 'claude', args: ['mcp', 'list'] };

function setup(overrides: Partial<NativeRunContext> = {}) {
  const runner = vi.fn<CommandRunner>().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
  const ctx: NativeRunContext = { engine: 'claude', binary: '/bin/claude', configDir, runner, baseEnv: {}, ...overrides };
  return { runner, ctx };
}

function envOf(runner: ReturnType<typeof setup>['runner']): NodeJS.ProcessEnv {
  const call = runner.mock.calls[0];
  if (call === undefined) throw new Error('El runner no se llamó');
  return call[2].env;
}

describe('runNativeCommand', () => {
  it('runNativeCommand_claude_setsClaudeConfigDirAndScrubsEnv', async () => {
    // Arrange
    const baseEnv = { PATH: 'p', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'o', CLAUDE_CONFIG_DIR: resolve('/otro') };
    const { runner, ctx } = setup({ baseEnv });
    // Act
    await runNativeCommand(ctx, command);
    // Assert
    expect(runner).toHaveBeenCalledWith('/bin/claude', ['mcp', 'list'], {
      env: expect.any(Object),
      timeoutMs: NATIVE_COMMAND_TIMEOUT_MS,
    });
    const env = envOf(runner);
    expect(env.PATH).toBe('p');
    expect(env.CLAUDE_CONFIG_DIR).toBe(configDir);
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('runNativeCommand_codex_setsCodexHome', async () => {
    // Arrange
    const { runner, ctx } = setup({ engine: 'codex', baseEnv: { CODEX_API_KEY: 'c' } });
    // Act
    await runNativeCommand(ctx, { engine: 'codex', args: ['mcp', 'list'] });
    // Assert
    const env = envOf(runner);
    expect(env.CODEX_HOME).toBe(configDir);
    expect(env).not.toHaveProperty('CODEX_API_KEY');
  });

  it('runNativeCommand_everyBlockedVar_isRemoved', async () => {
    // Arrange
    const baseEnv = Object.fromEntries(BLOCKED_AGENT_ENV_VARS.map((name) => [name, 'secreto']));
    const { runner, ctx } = setup({ baseEnv });
    // Act
    await runNativeCommand(ctx, command);
    // Assert
    const env = envOf(runner);
    for (const name of BLOCKED_AGENT_ENV_VARS) expect(env).not.toHaveProperty(name);
  });

  it('runNativeCommand_baseEnv_isNotMutated', async () => {
    // Arrange
    const baseEnv = { ANTHROPIC_API_KEY: 'k' };
    const { ctx } = setup({ baseEnv });
    // Act
    await runNativeCommand(ctx, command);
    // Assert
    expect(baseEnv.ANTHROPIC_API_KEY).toBe('k');
  });

  it.each(['', '   ', 'relativo/dir'])('runNativeCommand_missingConfigDir_throwsWithoutRunning', async (badDir) => {
    // Arrange
    const { runner, ctx } = setup({ configDir: badDir });
    // Act / Assert
    await expect(runNativeCommand(ctx, command)).rejects.toThrow(/config dir/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('runNativeCommand_emptyBinary_throwsWithoutRunning', async () => {
    // Arrange
    const { runner, ctx } = setup({ binary: '  ' });
    // Act / Assert
    await expect(runNativeCommand(ctx, command)).rejects.toThrow(/Binario de claude vacío/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('runNativeCommand_engineMismatch_throwsWithoutRunning', async () => {
    // Arrange
    const { runner, ctx } = setup();
    // Act / Assert
    await expect(runNativeCommand(ctx, { engine: 'codex', args: ['mcp', 'list'] })).rejects.toThrow(/codex.*claude/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('runNativeCommand_success_returnsStdout', async () => {
    // Arrange
    const { ctx } = setup();
    // Act
    const stdout = await runNativeCommand(ctx, command);
    // Assert
    expect(stdout).toBe('ok');
  });

  it('runNativeCommand_nonZeroExit_throwsNativeCommandErrorWithOutput', async () => {
    // Arrange
    const { runner, ctx } = setup();
    runner.mockResolvedValue({ exitCode: 1, stdout: 'out', stderr: 'MCP server demo already exists' });
    // Act
    const error = await runNativeCommand(ctx, command).catch((e: unknown) => e);
    // Assert
    expect(error).toBeInstanceOf(NativeCommandError);
    const native = error as NativeCommandError;
    expect(native.message).toContain('already exists');
    expect(native.message).toContain('código 1');
    expect(native.message).toContain('out');
    expect(native.result.stderr).toBe('MCP server demo already exists');
  });

  it('runNativeCommand_killedProcess_throwsNativeCommandError', async () => {
    // Arrange
    const { runner, ctx } = setup();
    runner.mockResolvedValue({ exitCode: null, stdout: '', stderr: '[proceso terminado: x]' });
    // Act / Assert
    await expect(runNativeCommand(ctx, command)).rejects.toThrow(/sin código/);
  });

  it('runNativeCommand_longStderr_truncatesMessage', async () => {
    // Arrange
    const { runner, ctx } = setup();
    runner.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'x'.repeat(5000) });
    // Act
    const error = (await runNativeCommand(ctx, command).catch((e: unknown) => e)) as Error;
    // Assert
    expect(error.message.length).toBeLessThan(3000);
  });
});

describe('runNativeCommands', () => {
  it('runNativeCommands_secondFails_stopsBeforeThird', async () => {
    // Arrange
    const { runner, ctx } = setup();
    runner
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'a', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'boom' });
    // Act / Assert
    await expect(runNativeCommands(ctx, [command, command, command])).rejects.toBeInstanceOf(NativeCommandError);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('runNativeCommands_allSucceed_returnsStdoutInOrder', async () => {
    // Arrange
    const { runner, ctx } = setup();
    runner
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'a', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'b', stderr: '' });
    // Act
    const outputs = await runNativeCommands(ctx, [command, command]);
    // Assert
    expect(outputs).toEqual(['a', 'b']);
  });
});
