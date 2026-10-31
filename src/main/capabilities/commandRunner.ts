import { execFile } from 'node:child_process';

// Resultado de un CLI que SÍ arrancó. `exitCode` null = lo terminó una señal (p. ej. el timeout).
export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export interface CommandRunOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}
export type CommandRunner = (bin: string, args: readonly string[], options: CommandRunOptions) => Promise<CommandResult>;

const NATIVE_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// Traduce el resultado de `execFile` a un `CommandResult`. Un código numérico es la salida del CLI; un código de
// texto (ENOENT, EACCES, maxBuffer…) es que el proceso no arrancó o se cortó su salida: eso es un error, no un resultado.
export function toCommandResult(
  error: (Error & { code?: unknown }) | null,
  stdout: string,
  stderr: string,
  bin: string,
): CommandResult {
  if (error === null) return { exitCode: 0, stdout, stderr };
  if (typeof error.code === 'number') return { exitCode: error.code, stdout, stderr };
  if (typeof error.code === 'string') {
    throw new Error(`No se pudo ejecutar ${bin}: ${error.message}`, { cause: error });
  }
  const separator = stderr.length > 0 ? '\n' : '';
  return { exitCode: null, stdout, stderr: `${stderr}${separator}[proceso terminado: ${error.message}]` };
}

// Sin shell: los argumentos viajan en array y ninguno se interpreta. Mismo motivo que `execCapture.ts`, que no sirve
// aquí porque descarta stderr y el código de salida.
export const execFileRunner: CommandRunner = (bin, args, options) =>
  new Promise<CommandResult>((resolve, reject) => {
    execFile(
      bin,
      [...args],
      { env: options.env, timeout: options.timeoutMs, windowsHide: true, maxBuffer: NATIVE_MAX_BUFFER_BYTES, encoding: 'utf8' },
      (error, stdout, stderr) => {
        try {
          resolve(toCommandResult(error, stdout, stderr, bin));
        } catch (err) {
          reject(err);
        }
      },
    );
  });
