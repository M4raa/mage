// Mide si se puede entregar el código de autorización a agy en modo `--print` cuando Mage lo lanza OCULTO y con pipes:
// agy lo lee de la CONSOLA (CONIN$), no de stdin (changelog de agy 1.3.x). Se inyecta como pulsaciones de teclado con
// AttachConsole + WriteConsoleInput desde un PowerShell auxiliar. Se manda un código INVENTADO: lo que se comprueba es
// que agy lo RECIBE (su log dice «submitting manually-entered auth code» y luego falla el intercambio), no que el login
// complete. Uso: node spike/agy-console-inject-spike.mjs [--sin-inyeccion]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INJECT_PS1 = String.raw`
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
    // Tras AttachConsole el STD_INPUT_HANDLE heredado no vale: se abre el buffer de entrada de ESA consola.
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

const profile = mkdtempSync(join(tmpdir(), 'mage-agy-inject-'));
const inject = !process.argv.includes('--sin-inyeccion');
const t0 = Date.now();
const stamp = (label) => console.log(`[${String(Date.now() - t0).padStart(6)} ms] ${label}`);
const child = spawn('agy', ['--print', '/usage'], { cwd: profile, env: { ...process.env, USERPROFILE: profile, SSH_CONNECTION: '1.1.1.1 22 2.2.2.2 22' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  for (let i = 0; i < 60 && !out.includes('paste the authorization code'); i += 1) await wait(250);
  stamp('agy listo para recibir el código');
  if (inject) {
    const helper = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& { ${INJECT_PS1.replace(/\r?\n/g, '\n')} } -TargetPid ${child.pid}`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let helperOut = '';
    helper.stdout.on('data', (c) => { helperOut += c; });
    helper.stderr.on('data', (c) => { helperOut += c; });
    helper.stdin.write('4/0AbCdEfGhIjKlMnOpQrStUv_inventado\n');
    helper.stdin.end();
    await new Promise((done) => helper.on('exit', done));
    stamp(`inyección: ${helperOut.trim().slice(0, 200) || '(sin salida)'}`);
  }
  await wait(8000);
  const logDir = join(profile, '.gemini', 'antigravity-cli', 'log');
  const lines = (existsSync(logDir) ? readdirSync(logDir) : []).flatMap((f) => readFileSync(join(logDir, f), 'utf8').split('\n'));
  const hits = lines.map((l) => l.replace(/[A-Za-z0-9_-]{40,}/g, '<X>')).filter((l) => /manually-entered|exchange authorization|authorization code|invalid_grant|oauth.*(fail|error)/i.test(l));
  stamp(`log de agy: ${hits.length} líneas sobre el código`);
  for (const l of hits.slice(0, 8)) console.log('   ', l.slice(0, 200));
  stamp(`salida visible de agy: ${JSON.stringify(out.replace(/https:\/\/accounts\.google\.com\S+/g, '<URL>').trim().slice(-220))}`);
} finally {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  await wait(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
