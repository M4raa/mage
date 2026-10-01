import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { z } from 'zod';
import type { ToolOutcome } from '../agentLoop';
import type { KillableChild, KillOutcome } from '../../os/processTree';
import type { ResolvedShell } from '../../os/shellResolver';
import { truncateOutput, type RuntimeTool } from './types';

// `Bash` del runtime propio: ejecuta un comando con la shell de `shellResolver` (ficha D4) en el cwd,
// con el entorno SANEADO (`scrubAgentEnv`: ninguna clave del usuario llega al comando), salida combinada
// y truncada, timeout y muerte del ARBOL de procesos al abortar.

export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BASH_MAX_TIMEOUT_MS = 600_000;
// Lo que se guarda en memoria de la salida; el modelo ve aun menos (`truncateOutput`).
const BASH_MAX_CAPTURE_CHARS = 200_000;

export interface BashToolDeps {
  readonly shell: ResolvedShell;
  readonly spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  // Entorno YA saneado con `scrubAgentEnv`.
  readonly env: () => NodeJS.ProcessEnv;
  readonly killTree: (child: KillableChild) => KillOutcome;
}

const BASH_INPUT = z.object({
  command: z.string().min(1),
  timeout: z.coerce.number().int().positive().max(BASH_MAX_TIMEOUT_MS).optional(),
  description: z.string().optional(),
});

export function createBashTool(deps: BashToolDeps): RuntimeTool<z.infer<typeof BASH_INPUT>> {
  return {
    name: 'Bash',
    kind: 'exec',
    description: `Run a shell command (${deps.shell.name}) in the working directory. Output is combined stdout+stderr.`,
    fields: {
      command: { type: 'string', description: `Command for ${deps.shell.name}`, required: true },
      timeout: { type: 'number', description: `Timeout in ms (default ${BASH_DEFAULT_TIMEOUT_MS}, max ${BASH_MAX_TIMEOUT_MS})`, required: false },
      description: { type: 'string', description: 'What the command does, in a few words', required: false },
    },
    input: BASH_INPUT,
    run: (input, ctx) => runCommand(deps, input.command, input.timeout ?? BASH_DEFAULT_TIMEOUT_MS, ctx.cwd, ctx.signal),
  };
}

function runCommand(deps: BashToolDeps, command: string, timeoutMs: number, cwd: string, signal: AbortSignal): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    let output = '';
    let ended: 'timeout' | 'aborted' | null = null;
    const child = deps.spawn(deps.shell.command, deps.shell.argsFor(command), { cwd, env: deps.env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = (data: Buffer | string) => {
      if (output.length < BASH_MAX_CAPTURE_CHARS) output += data.toString();
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const stop = (reason: 'timeout' | 'aborted') => {
      ended = reason;
      deps.killTree(child);
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const onAbort = () => stop('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = (outcome: ToolOutcome) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    child.once('error', (err) => finish({ isError: true, output: `No se pudo lanzar ${deps.shell.name} (${deps.shell.command}): ${err.message}` }));
    child.once('close', (code) => finish(describeExit(output, code, ended, timeoutMs)));
  });
}

function describeExit(output: string, code: number | null, ended: 'timeout' | 'aborted' | null, timeoutMs: number): ToolOutcome {
  const body = output.trim().length === 0 ? '(sin salida)' : output;
  if (ended === 'timeout') return { isError: true, output: truncateOutput(`${body}\n[cortado: superó el tiempo de ${timeoutMs} ms]`) };
  if (ended === 'aborted') return { isError: true, output: truncateOutput(`${body}\n[interrumpido por el usuario]`) };
  if (code !== 0) return { isError: true, output: truncateOutput(`${body}\n[código de salida ${code ?? 'desconocido'}]`) };
  return { isError: false, output: truncateOutput(body) };
}
