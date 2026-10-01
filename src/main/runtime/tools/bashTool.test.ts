import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { scrubAgentEnv } from '../../os/agentEnv';
import type { ResolvedShell } from '../../os/shellResolver';
import { createBashTool, type BashToolDeps } from './bashTool';

// Shell portable para los tests: el propio node como "shell" (`node -e <script>`), asi el test no
// depende de que haya bash o PowerShell en la maquina.
const NODE_SHELL: ResolvedShell = { name: 'node', command: process.execPath, argsFor: (script) => ['-e', script] };

function deps(overrides: Partial<BashToolDeps> = {}): BashToolDeps {
  return {
    shell: NODE_SHELL,
    spawn: (command, args, options) => spawn(command, [...args], options),
    env: () => scrubAgentEnv({ ...process.env, ANTHROPIC_API_KEY: 'sk-ant-secreta' }),
    killTree: (child) => {
      child.kill('SIGKILL');
      return 'signal';
    },
    ...overrides,
  };
}

const ctx = (signal = new AbortController().signal) => ({ cwd: process.cwd(), extraDirs: [], signal });

describe('Bash', () => {
  it('run_output_combinesStdoutAndStderr', async () => {
    const out = await createBashTool(deps()).run({ command: 'console.log("uno"); console.error("dos")' }, ctx());

    expect(out.isError).toBe(false);
    expect(out.output).toContain('uno');
    expect(out.output).toContain('dos');
  });

  it('run_nonZeroExit_errorWithCode', async () => {
    const out = await createBashTool(deps()).run({ command: 'process.exit(3)' }, ctx());

    expect(out).toEqual({ isError: true, output: '(sin salida)\n[código de salida 3]' });
  });

  it('run_timeout_killsAndSaysSo', async () => {
    const killTree = vi.fn((child: { kill: (s: NodeJS.Signals) => boolean }) => {
      child.kill('SIGKILL');
      return 'signal' as const;
    });

    const out = await createBashTool(deps({ killTree })).run({ command: 'setInterval(() => {}, 1000)', timeout: 200 }, ctx());

    expect(killTree).toHaveBeenCalledTimes(1);
    expect(out.output).toMatch(/200 ms/);
  });

  it('run_abort_callsKillTree', async () => {
    const controller = new AbortController();
    const killTree = vi.fn((child: { kill: (s: NodeJS.Signals) => boolean }) => {
      child.kill('SIGKILL');
      return 'signal' as const;
    });

    const pending = createBashTool(deps({ killTree })).run({ command: 'setInterval(() => {}, 1000)' }, ctx(controller.signal));
    setTimeout(() => controller.abort(), 100);
    const out = await pending;

    expect(killTree).toHaveBeenCalledTimes(1);
    expect(out.output).toMatch(/interrumpido/);
  });

  it('run_env_hasNoApiKey', async () => {
    const out = await createBashTool(deps()).run({ command: 'console.log(String(process.env.ANTHROPIC_API_KEY))' }, ctx());

    expect(out.output.trim()).toBe('undefined');
  });

  it('run_missingShell_errorExplained', async () => {
    const out = await createBashTool(deps({ shell: { name: 'Nada', command: 'no-existe-este-shell-xyz', argsFor: () => [] } })).run({ command: 'x' }, ctx());

    expect(out).toMatchObject({ isError: true, output: expect.stringContaining('No se pudo lanzar Nada') });
  });
});
