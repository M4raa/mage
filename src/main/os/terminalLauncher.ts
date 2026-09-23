import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { platform as osPlatform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCKED_AGENT_ENV_VARS } from './agentEnv';

// Comando de terminal a lanzar: ejecutable + argumentos ya resueltos por SO.
export interface TerminalCommand {
  readonly command: string;
  readonly args: readonly string[];
}

// Dependencias inyectables -> testable sin lanzar procesos ni escribir en disco real.
export interface TerminalDeps {
  readonly platform: NodeJS.Platform;
  readonly spawnDetached: (command: string, args: readonly string[]) => void;
  // Escribe un script temporal y devuelve su ruta (Windows lanza el login via un .bat para evitar
  // el anidamiento de comillas de cmd a traves de spawn).
  readonly writeTempScript: (content: string, ext: string) => string;
}

// Subcomando de login por SUSCRIPCION (verificado en el fuente: `claude auth login`). `--claudeai`
// fuerza el flujo de suscripcion (NO `--console`, que facturaria API) -> invariante del proyecto.
const LOGIN_COMMAND = 'auth login --claudeai';

// Opciones de login. privateWindow abre el navegador del login en ventana privada/incognito (sesion
// limpia) para poder iniciar sesion con OTRA cuenta aunque el navegador ya tenga una activa.
export interface LoginOptions {
  readonly privateWindow?: boolean;
}

// Lanza el login OAuth interactivo (`claude auth login`) en una terminal del SO. Headless NO puede
// loguear: hace falta una TTY + navegador. Toda la diferencia de SO queda encapsulada aqui
// (invariante multiplataforma). El login se difiere a una terminal externa; la embebida se valora en M3.
export class TerminalLauncher {
  constructor(private readonly deps: TerminalDeps = defaultTerminalDeps()) {}

  launchLogin(configDir: string, binary: string, options: LoginOptions = {}): void {
    if (configDir.length === 0) throw new Error('El configDir de la cuenta no puede estar vacio');
    if (binary.length === 0) throw new Error('El binario de Claude no puede estar vacio');

    // Windows: escribir un .bat y lanzarlo con `start ... cmd /k`. En el .bat las variables se expanden
    // en tiempo de ejecucion y la ruta del .exe se cita sin que spawn la re-escape (raiz del bug).
    if (this.deps.platform === 'win32') {
      // Ventana privada: BROWSER apunta a un wrapper .bat que abre Edge InPrivate (Edge esta siempre
      // en Windows 11; InPrivate da sesion limpia sea cual sea el navegador habitual del usuario).
      const browserWrapper = options.privateWindow
        ? this.deps.writeTempScript(buildWindowsInPrivateBrowserWrapper(), 'bat')
        : null;
      const scriptPath = this.deps.writeTempScript(
        buildWindowsScript(binary, configDir, browserWrapper),
        'bat',
      );
      this.deps.spawnDetached('cmd', ['/c', 'start', 'Mage login', 'cmd', '/k', scriptPath]);
      return;
    }

    const plan = buildPosixTerminalCommand(this.deps.platform, binary, configDir, options);
    this.deps.spawnDetached(plan.command, plan.args);
  }
}

// Wrapper .bat para BROWSER: abre la URL en Edge InPrivate. La CLI envuelve la URL en comillas y
// execa/cross-spawn puede anadir otra capa al invocar el .bat -> se eliminan TODAS las comillas (la
// URL nunca lleva) y se re-cita una sola vez. Delayed expansion protege los `&` de la URL. `start ""
// msedge` resuelve Edge por App Paths.
export function buildWindowsInPrivateBrowserWrapper(): string {
  return [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    'set "URL=%~1"',
    'set "URL=!URL:"=!"',
    'start "" msedge --inprivate "!URL!"',
    '',
  ].join('\r\n');
}

// Contenido del .bat de login (Windows). Cada linea se ejecuta en orden -> %CLAUDE_CONFIG_DIR% se
// expande de verdad; la ruta del binario va entre comillas y funciona (no hay re-escape de spawn).
// Si browserWrapper != null, fija BROWSER para abrir el login en ventana privada.
export function buildWindowsScript(binary: string, configDir: string, browserWrapper: string | null = null): string {
  return [
    '@echo off',
    // Se limpian TODAS las prohibidas, no solo la clave de API (B2): esta ventana lanza un `claude`
    // de verdad, asi que hereda el entorno del usuario igual que un hijo nuestro. La lista es la
    // misma de `agentEnv.ts` para que no puedan divergir.
    ...BLOCKED_AGENT_ENV_VARS.map((name) => `set "${name}="`),
    `set "CLAUDE_CONFIG_DIR=${configDir}"`,
    ...(browserWrapper !== null ? [`set "BROWSER=${browserWrapper}"`] : []),
    'echo Login de la cuenta: %CLAUDE_CONFIG_DIR%',
    'echo (elige SUSCRIPCION, no consola/API; no cierres esta ventana hasta terminar)',
    `"${binary}" ${LOGIN_COMMAND}`,
    '',
  ].join('\r\n');
}

// Comando de terminal para POSIX (macOS/Linux). La linea de shell fija CLAUDE_CONFIG_DIR y borra
// las variables prohibidas de `agentEnv.ts`, embebidas en la orden (no depende de la herencia de
export function buildPosixTerminalCommand(
  platform: NodeJS.Platform,
  binary: string,
  configDir: string,
  _options: LoginOptions = {},
): TerminalCommand {
  if (binary.length === 0) throw new Error('El binario de Claude no puede estar vacio');
  if (configDir.length === 0) throw new Error('El configDir de la cuenta no puede estar vacio');

  // NOTA: la ventana privada (_options.privateWindow) esta implementada solo en Windows por ahora
  // (Edge InPrivate). En POSIX el modo privado depende del navegador; se abordara al empaquetar Linux/mac.
  const line =
    `unset ${BLOCKED_AGENT_ENV_VARS.join(' ')}; export CLAUDE_CONFIG_DIR=${posixQuote(configDir)}; ` +
    `echo "Login de la cuenta: $CLAUDE_CONFIG_DIR"; ${posixQuote(binary)} ${LOGIN_COMMAND}`;

  if (platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${appleScriptQuote(line)}`;
    return { command: 'osascript', args: ['-e', script, '-e', 'tell application "Terminal" to activate'] };
  }
  // Linux/otros POSIX: emulador estandar de Debian/alternatives (best-effort; ver BITACORA).
  return { command: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `${line}; exec bash`] };
}

// Comilla simple POSIX: envuelve en '...' y escapa comillas simples internas.
function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Comilla para AppleScript (do script "..."): envuelve en "..." escapando \ y ".
function appleScriptQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function defaultTerminalDeps(): TerminalDeps {
  return {
    platform: osPlatform(),
    // detached + unref: la terminal sobrevive a Mage; stdio ignorado (no colgar el proceso hijo).
    spawnDetached: (command, args) => {
      const child = spawn(command, [...args], { detached: true, stdio: 'ignore' });
      child.unref();
    },
    writeTempScript: (content, ext) => {
      const file = join(tmpdir(), `mage-login-${randomUUID()}.${ext}`);
      writeFileSync(file, content, 'utf8');
      return file;
    },
  };
}
