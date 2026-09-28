import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Ejecuta un binario y devuelve su stdout. `execFile` y no `exec`: SIN shell, los argumentos viajan en
// array y ninguno se interpreta. Lanza (con el mensaje del propio proceso) si falla o si pasa de
// `timeoutMs`. Salio de `providerProbe.ts` para que git (P-026 3.5) use exactamente lo mismo.

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

export interface ExecCaptureOptions {
  readonly timeoutMs: number;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxBufferBytes?: number;
}

export async function execCapturingStdout(bin: string, args: readonly string[], options: ExecCaptureOptions): Promise<string> {
  const { stdout } = await execFileAsync(bin, [...args], {
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  return stdout;
}
