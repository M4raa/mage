// Entrega del código de autorización a agy. MEDIDO en agy 1.3.1 (`spike/agy-console-inject-spike.mjs`): en modo
// `--print` agy lee el código de la CONSOLA (`CONIN$` en Windows), no de la entrada estándar (su changelog: «pasting
// the OAuth authorization code in print mode via the controlling terminal»). Mage lanza agy oculto y con pipes, así
// que escribir en stdin no llega a ningún sitio: agy se queda esperando sus 60 s y muere con «authentication timed
// out». Se entrega como pulsaciones de teclado en la consola oculta de agy: un PowerShell auxiliar hace
// `AttachConsole(pid)` + `WriteConsoleInput` (en el spike, agy lo recibió y contestó al instante).
// El código viaja por la ENTRADA ESTÁNDAR del auxiliar, nunca por su línea de comandos (se vería en la lista de procesos).

export interface ConsoleHelperProcess {
  readonly stdin: { write: (text: string) => unknown; end: () => unknown };
  readonly stdout: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown };
  readonly stderr: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown };
  on: (event: 'exit' | 'error', listener: () => void) => unknown;
}

export interface ConsoleInputDeps {
  readonly spawnHelper: (script: string, targetPid: number) => ConsoleHelperProcess;
  readonly timeoutMs: number;
}

// La respuesta del auxiliar: «ok <n>» o «<paso> fallo: <código de Windows>».
const OK_PATTERN = /^ok \d+/m;

export const CONSOLE_INPUT_SCRIPT = String.raw`
param([int]$TargetPid)
$code = [Console]::In.ReadLine()
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleKeys {
  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
  public struct KEY_EVENT_RECORD {
    [FieldOffset(0)] public int bKeyDown;
    [FieldOffset(4)] public ushort wRepeatCount;
    [FieldOffset(6)] public ushort wVirtualKeyCode;
    [FieldOffset(8)] public ushort wVirtualScanCode;
    [FieldOffset(10)] public char UnicodeChar;
    [FieldOffset(12)] public uint dwControlKeyState;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool WriteConsoleInput(IntPtr h, INPUT_RECORD[] buf, uint len, out uint written);
  public static string Send(uint pid, string text) {
    FreeConsole();
    if (!AttachConsole(pid)) return "AttachConsole fallo: " + Marshal.GetLastWin32Error();
    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "CONIN$ fallo: " + Marshal.GetLastWin32Error();
    var records = new INPUT_RECORD[(text.Length + 1) * 2];
    int i = 0;
    foreach (char c in (text + "\r").ToCharArray()) {
      foreach (int down in new[] { 1, 0 }) {
        records[i].EventType = 1;
        records[i].KeyEvent.bKeyDown = down;
        records[i].KeyEvent.wRepeatCount = 1;
        records[i].KeyEvent.wVirtualKeyCode = (ushort)(c == '\r' ? 13 : 0);
        records[i].KeyEvent.UnicodeChar = c;
        i++;
      }
    }
    uint written;
    bool ok = WriteConsoleInput(h, records, (uint)records.Length, out written);
    FreeConsole();
    return ok ? "ok " + written : "WriteConsoleInput fallo: " + Marshal.GetLastWin32Error();
  }
}
"@
[ConsoleKeys]::Send([uint32]$TargetPid, $code)
`;

// Escribe `text` + Intro en la consola del proceso `targetPid`. Resuelve cuando Windows lo ha aceptado y rechaza con el
// paso que falló (nunca con el texto).
export function sendToConsole(deps: ConsoleInputDeps, targetPid: number, text: string): Promise<void> {
  if (!Number.isInteger(targetPid) || targetPid <= 0) return Promise.reject(new Error(`pid invalido para escribir en su consola: ${String(targetPid)}`));
  if (text.length === 0 || /[\r\n]/.test(text)) return Promise.reject(new Error('El texto para la consola debe ser una sola linea no vacia'));
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === null) resolve();
      else reject(error);
    };
    const helper = deps.spawnHelper(CONSOLE_INPUT_SCRIPT, targetPid);
    const timer = setTimeout(() => finish(new Error(`El auxiliar de consola no respondio en ${deps.timeoutMs} ms`)), deps.timeoutMs);
    const collect = (chunk: Buffer | string): void => { output += chunk.toString(); };
    helper.stdout.on('data', collect);
    helper.stderr.on('data', collect);
    helper.on('error', () => finish(new Error('No se pudo lanzar PowerShell para escribir en la consola de agy')));
    helper.on('exit', () => finish(OK_PATTERN.test(output) ? null : new Error(`No se pudo escribir en la consola de agy: ${output.trim().split('\n')[0]?.slice(0, 120) ?? 'sin salida'}`)));
    helper.stdin.write(`${text}\n`);
    helper.stdin.end();
  });
}
