import type { BusCall } from './linuxKeyring';

// La llamada D-Bus del detector del llavero (D1) con `dbus-send`, el cliente que trae el paquete de D-Bus: nada de
// módulos nativos en Node (§3.4). El plazo se aplica dos veces: el de la respuesta de D-Bus y el del proceso, que se
// mata si no termina a tiempo.

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly encoding: 'utf8'; readonly windowsHide: true },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

export function createDbusSend(execFile: ExecFileFn): BusCall {
  return (destination, objectPath, method, args, timeoutMs) =>
    new Promise((resolve, reject) => {
      const argv = ['--session', '--print-reply', `--reply-timeout=${timeoutMs}`, `--dest=${destination}`, objectPath, method, ...args];
      execFile('dbus-send', argv, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        const reason = stderr.trim().length > 0 ? stderr.trim() : error.message;
        reject(new Error(`${method}: ${reason}`));
      });
    });
}
