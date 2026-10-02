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
// M4: tras `exit` (o tras matar el arbol), cuanto se espera a `close`. Un nieto que hereda los pipes
// (`npm run dev &`) los mantiene abiertos y `close` no llegaria nunca: el turno se colgaria.
export const BASH_CLOSE_GRACE_MS = 2_000;

export interface BashToolDeps {
  readonly shell: ResolvedShell;
  readonly spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  // Entorno YA saneado con `scrubAgentEnv`.
  readonly env: () => NodeJS.ProcessEnv;
  readonly killTree: (child: KillableChild) => KillOutcome;
  readonly closeGraceMs?: number;
}

interface CommandRun {
  readonly command: string;
  readonly timeoutMs: number;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

type EndReason = 'timeout' | 'aborted' | null;

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
    run: (input, ctx) => runCommand(deps, { command: input.command, timeoutMs: input.timeout ?? BASH_DEFAULT_TIMEOUT_MS, cwd: ctx.cwd, signal: ctx.signal }),
  };
}

function runCommand(deps: BashToolDeps, run: CommandRun): Promise<ToolOutcome> {
  // B3: con la senal ya abortada, `abort` no volveria a saltar: no se lanza nada.
  if (run.signal.aborted) return Promise.resolve(describeExit('', null, 'aborted', run.timeoutMs));
  return new Promise((resolve) => {
    const child = deps.spawn(deps.shell.command, deps.shell.argsFor(run.command), { cwd: run.cwd, env: deps.env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = captureOutput(child);
    let ended: EndReason = null;
    let grace: NodeJS.Timeout | null = null;
    const finish = (outcome: ToolOutcome) => {
      clearTimeout(timer);
      if (grace !== null) clearTimeout(grace);
      run.signal.removeEventListener('abort', onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(outcome);
    };
    const finishSoon = () => {
      grace ??= setTimeout(() => finish(describeExit(capture.text(), child.exitCode, ended, run.timeoutMs)), deps.closeGraceMs ?? BASH_CLOSE_GRACE_MS);
    };
    const stop = (reason: 'timeout' | 'aborted') => {
      ended = reason;
      deps.killTree(child);
      finishSoon();
    };
    const timer = setTimeout(() => stop('timeout'), run.timeoutMs);
    const onAbort = () => stop('aborted');
    run.signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (err) => finish({ isError: true, output: `No se pudo lanzar ${deps.shell.name} (${deps.shell.command}): ${err.message}` }));
    child.once('exit', finishSoon);
    child.once('close', (code) => finish(describeExit(capture.text(), code, ended, run.timeoutMs)));
  });
}

// B2: `setEncoding` reensambla un caracter UTF-8 partido entre dos trozos (`toString` por trozo no).
function captureOutput(child: ChildProcess): { text(): string } {
  let output = '';
  const append = (data: string) => {
    if (output.length < BASH_MAX_CAPTURE_CHARS) output += data;
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', append);
  }
  return { text: () => output };
}

function describeExit(output: string, code: number | null, ended: EndReason, timeoutMs: number): ToolOutcome {
  const body = output.trim().length === 0 ? '(sin salida)' : output;
  if (ended === 'timeout') return { isError: true, output: truncateOutput(`${body}\n[cortado: superó el tiempo de ${timeoutMs} ms]`) };
  if (ended === 'aborted') return { isError: true, output: truncateOutput(`${body}\n[interrumpido por el usuario]`) };
  if (code !== 0) return { isError: true, output: truncateOutput(`${body}\n[código de salida ${code ?? 'desconocido'}]`) };
  return { isError: false, output: truncateOutput(body) };
}
