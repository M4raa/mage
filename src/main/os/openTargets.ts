// Comando por SO para abrir una terminal en un directorio (M2.3, "Open with"). PURO y testeable:
// devuelve {command, args}; el cwd se aplica por la OPCION `cwd` del spawn (no con `cd`), evitando el
// escapado de comillas. En macOS `open -a Terminal <dir>` sí necesita el path como argumento.
export interface OpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

// Editores candidatos a detectar en el PATH (M2.3, "Abrir en <editor>"). El `bin` es el comando de
// linea (shim) que instalan; el `label` es lo que ve el usuario en el menu.
export interface EditorCandidate {
  readonly bin: string;
  readonly label: string;
}

export const EDITOR_CANDIDATES: readonly EditorCandidate[] = [
  { bin: 'code', label: 'VS Code' },
  { bin: 'cursor', label: 'Cursor' },
  { bin: 'codium', label: 'VSCodium' },
  { bin: 'subl', label: 'Sublime Text' },
] as const;

// Comando para abrir la carpeta `cwd` en el editor `bin`. En win32 los shims de estos editores son
// scripts .cmd (no .exe): spawn no los resuelve directamente, hay que lanzarlos via `cmd /c`.
export function buildOpenEditorCommand(platform: NodeJS.Platform, bin: string, cwd: string): OpenCommand {
  if (bin.trim().length === 0) throw new Error(`bin vacio para abrir editor: ${JSON.stringify(bin)}`);
  if (cwd.trim().length === 0) throw new Error(`cwd vacio para abrir editor: ${JSON.stringify(cwd)}`);
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', bin, cwd] };
  }
  return { command: bin, args: [cwd] };
}

export function buildOpenTerminalCommand(platform: NodeJS.Platform, cwd: string): OpenCommand {
  if (cwd.trim().length === 0) throw new Error(`cwd vacio para abrir terminal: ${JSON.stringify(cwd)}`);
  if (platform === 'win32') {
    // `start "" cmd` abre una nueva ventana de cmd cuyo directorio inicial es el cwd del proceso que
    // la lanza (se fija con la opcion `cwd` del spawn); el "" es el titulo (requerido por `start`).
    return { command: 'cmd', args: ['/c', 'start', '', 'cmd'] };
  }
  if (platform === 'darwin') {
    // `open -a Terminal <dir>` abre Terminal.app en ese directorio (el arg del path es necesario).
    return { command: 'open', args: ['-a', 'Terminal', cwd] };
  }
  // Linux/otros POSIX: emulador estandar de Debian/alternatives; hereda el cwd del spawn.
  return { command: 'x-terminal-emulator', args: [] };
}

// --- Ventana privada del navegador (Fase 9.2) --------------------------------------------------

// Un navegador candidato para abrir el login en ventana PRIVADA. `flag` es su bandera de sesion
// limpia; `path` la ruta/comando con el que se lanza.
//
// Por que hace falta: el alta de cuenta abre la pagina de login de Anthropic. En un navegador con la
// sesion de otra cuenta ya iniciada, autoriza ESA — y la cuenta nueva acaba siendo la vieja sin que
// nadie se entere. La ventana privada es lo unico que garantiza un login limpio.
export interface PrivateBrowserCandidate {
  readonly path: string; // ruta absoluta (Windows/macOS) o comando del PATH (Linux)
  readonly flag: string;
  readonly label: string;
}

// LIMITE CONOCIDO, y no tiene arreglo por flags: Chrome y Edge reutilizan UN UNICO perfil de
// incognito entre ventanas, y Firefox una sola sesion privada. Si queda abierta la ventana privada de
// la cuenta #2 y se anade la #3, se aterriza en la sesion de la #2. Se avisa desde la UI.
//
// Safari queda fuera a proposito: no tiene bandera de linea de comandos para abrir en privado.
export function privateBrowserCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): readonly PrivateBrowserCandidate[] {
  if (platform === 'win32') return windowsCandidates(env);
  if (platform === 'darwin') {
    return [
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', flag: '--incognito', label: 'Chrome' },
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', flag: '--inprivate', label: 'Edge' },
      { path: '/Applications/Firefox.app/Contents/MacOS/firefox', flag: '-private-window', label: 'Firefox' },
      { path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', flag: '--incognito', label: 'Brave' },
    ];
  }
  // Linux y demas POSIX: los navegadores SI estan en el PATH con nombre estable.
  return [
    { path: 'google-chrome', flag: '--incognito', label: 'Chrome' },
    { path: 'chromium', flag: '--incognito', label: 'Chromium' },
    { path: 'chromium-browser', flag: '--incognito', label: 'Chromium' },
    { path: 'firefox', flag: '-private-window', label: 'Firefox' },
    { path: 'brave-browser', flag: '--incognito', label: 'Brave' },
    { path: 'microsoft-edge', flag: '--inprivate', label: 'Edge' },
  ];
}

// En Windows los navegadores NO estan en el PATH (medido el 2026-09-14: `where chrome|msedge|firefox`
// no encuentra ninguno en una maquina con Chrome y Edge instalados). Se buscan en sus rutas de
// instalacion, que salen de las variables del SO — nunca de un "C:\Program Files" escrito a mano, que
// se rompe en cuanto Windows no esta en C: o en ingles.
function windowsCandidates(env: Readonly<Record<string, string | undefined>>): readonly PrivateBrowserCandidate[] {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(
    (root): root is string => typeof root === 'string' && root.length > 0,
  );
  const relatives: readonly { readonly tail: string; readonly flag: string; readonly label: string }[] = [
    { tail: 'Google\\Chrome\\Application\\chrome.exe', flag: '--incognito', label: 'Chrome' },
    { tail: 'Microsoft\\Edge\\Application\\msedge.exe', flag: '--inprivate', label: 'Edge' },
    { tail: 'Mozilla Firefox\\firefox.exe', flag: '-private-window', label: 'Firefox' },
    { tail: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', flag: '--incognito', label: 'Brave' },
  ];
  return roots.flatMap((root) =>
    relatives.map((entry) => ({ path: `${root}\\${entry.tail}`, flag: entry.flag, label: entry.label })),
  );
}

// Comando para abrir `url` en ventana privada con un candidato concreto. La URL va como argumento
// SUELTO (nunca concatenada en una cadena de shell): se lanza sin shell, asi que sus `&` no reparsean.
export function buildPrivateBrowserCommand(candidate: PrivateBrowserCandidate, url: string): OpenCommand {
  if (url.trim().length === 0) throw new Error(`URL vacia para abrir en privado: ${JSON.stringify(url)}`);
  return { command: candidate.path, args: [candidate.flag, url] };
}
