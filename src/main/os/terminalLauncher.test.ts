import { describe, expect, it, vi } from 'vitest';
import {
  buildPosixTerminalCommand,
  buildWindowsInPrivateBrowserWrapper,
  buildWindowsScript,
  TerminalLauncher,
  type TerminalDeps,
} from './terminalLauncher';

const DIR = '/home/u/.claude-9';
const BIN = '/usr/bin/claude';

function deps(overrides: Partial<TerminalDeps>): TerminalDeps {
  return {
    platform: 'linux',
    spawnDetached: vi.fn(),
    writeTempScript: vi.fn(() => 'C:\\Temp\\mage-login-x.bat'),
    ...overrides,
  };
}

describe('buildWindowsScript', () => {
  it('buildWindowsScript_setsDirClearsApiKeyAndRunsAuthLogin', () => {
    const script = buildWindowsScript('C:\\bin\\claude.exe', 'C:\\Users\\u\\.claude-9');

    expect(script).toContain('set "CLAUDE_CONFIG_DIR=C:\\Users\\u\\.claude-9"');
    expect(script).toContain('set "ANTHROPIC_API_KEY="');
    expect(script).toContain('"C:\\bin\\claude.exe" auth login --claudeai');
  });

  it('buildWindowsScript_expandsVarAtRuntime_notAtParse', () => {
    // El echo usa %CLAUDE_CONFIG_DIR% (se expande al ejecutar el .bat, no en el literal).
    const script = buildWindowsScript('C:\\bin\\claude.exe', 'C:\\x');

    expect(script).toContain('echo Login de la cuenta: %CLAUDE_CONFIG_DIR%');
  });

  it('buildWindowsScript_noBrowserWrapper_doesNotSetBrowser', () => {
    const script = buildWindowsScript('C:\\bin\\claude.exe', 'C:\\x');

    expect(script).not.toContain('set "BROWSER=');
  });

  it('buildWindowsScript_withBrowserWrapper_setsBrowser', () => {
    const script = buildWindowsScript('C:\\bin\\claude.exe', 'C:\\x', 'C:\\Temp\\wrap.bat');

    expect(script).toContain('set "BROWSER=C:\\Temp\\wrap.bat"');
  });
});

describe('buildWindowsInPrivateBrowserWrapper', () => {
  it('buildWindowsInPrivateBrowserWrapper_opensEdgeInPrivate', () => {
    const wrapper = buildWindowsInPrivateBrowserWrapper();

    expect(wrapper).toContain('msedge --inprivate');
    expect(wrapper).toContain('set "URL=%~1"'); // captura el arg
    expect(wrapper).toContain('set "URL=!URL:"=!"'); // elimina TODAS las comillas
    expect(wrapper).toContain('EnableDelayedExpansion'); // protege los & de la URL
  });
});

describe('buildPosixTerminalCommand', () => {
  it('buildPosixTerminalCommand_emptyBinary_throws', () => {
    expect(() => buildPosixTerminalCommand('linux', '', DIR)).toThrow(/binario/i);
  });

  it('buildPosixTerminalCommand_emptyConfigDir_throws', () => {
    expect(() => buildPosixTerminalCommand('linux', BIN, '')).toThrow(/configDir/i);
  });

  it('buildPosixTerminalCommand_darwin_usesOsascriptDoScript', () => {
    const result = buildPosixTerminalCommand('darwin', BIN, DIR);

    expect(result.command).toBe('osascript');
    const script = result.args.join(' ');
    expect(script).toContain('do script');
    expect(script).toContain('export CLAUDE_CONFIG_DIR=');
    expect(script).toContain('unset ANTHROPIC_API_KEY');
    expect(script).toContain('auth login --claudeai');
  });

  it('buildPosixTerminalCommand_linux_usesTerminalEmulatorWithEnvLine', () => {
    const result = buildPosixTerminalCommand('linux', BIN, DIR);

    expect(result.command).toBe('x-terminal-emulator');
    expect(result.args).toContain('-lc');
    const line = result.args.join(' ');
    expect(line).toContain('export CLAUDE_CONFIG_DIR=');
    expect(line).toContain('auth login --claudeai');
  });
});

describe('TerminalLauncher.launchLogin', () => {
  it('launchLogin_emptyConfigDir_throws', () => {
    const launcher = new TerminalLauncher(deps({}));

    expect(() => launcher.launchLogin('', BIN)).toThrow(/configDir/i);
  });

  it('launchLogin_windows_writesBatAndLaunchesIt', () => {
    const spawnDetached = vi.fn();
    const writeTempScript = vi.fn(() => 'C:\\Temp\\mage-login-x.bat');
    const launcher = new TerminalLauncher(deps({ platform: 'win32', spawnDetached, writeTempScript }));

    launcher.launchLogin('C:\\Users\\u\\.claude-9', 'C:\\bin\\claude.exe');

    expect(writeTempScript).toHaveBeenCalledOnce();
    const [command, args] = spawnDetached.mock.calls[0]!;
    expect(command).toBe('cmd');
    expect(args).toContain('C:\\Temp\\mage-login-x.bat'); // se lanza el .bat, no la linea compuesta
  });

  it('launchLogin_windowsPrivateWindow_writesBrowserWrapperAndSetsBrowser', () => {
    const spawnDetached = vi.fn();
    // 1ª llamada: wrapper del navegador; 2ª: script de login (que referencia el wrapper).
    const writeTempScript = vi
      .fn()
      .mockReturnValueOnce('C:\\Temp\\wrap.bat')
      .mockImplementation((content: string) => {
        expect(content).toContain('set "BROWSER=C:\\Temp\\wrap.bat"');
        return 'C:\\Temp\\login.bat';
      });
    const launcher = new TerminalLauncher(deps({ platform: 'win32', spawnDetached, writeTempScript }));

    launcher.launchLogin('C:\\Users\\u\\.claude-9', 'C:\\bin\\claude.exe', { privateWindow: true });

    expect(writeTempScript).toHaveBeenCalledTimes(2);
    const [command, args] = spawnDetached.mock.calls[0]!;
    expect(command).toBe('cmd');
    expect(args).toContain('C:\\Temp\\login.bat');
  });

  it('launchLogin_linux_spawnsTerminalEmulator', () => {
    const spawnDetached = vi.fn();
    const launcher = new TerminalLauncher(deps({ platform: 'linux', spawnDetached }));

    launcher.launchLogin(DIR, BIN);

    const [command, args] = spawnDetached.mock.calls[0]!;
    expect(command).toBe('x-terminal-emulator');
    expect(args.join(' ')).toContain('auth login --claudeai');
  });
});
