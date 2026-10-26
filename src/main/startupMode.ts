import type { StartupWarning } from '@shared/ipc';

// Cómo arranca el proceso propietario (F2.6, §3.4 del plan). Puro: recibe plataforma, argumentos y entorno, así
// se prueba sin Electron.

// Pedir el modo sin pantalla a mano (pruebas, scripts): en Linux sin DISPLAY ni WAYLAND_DISPLAY es automático.
export const HEADLESS_FLAG = '--headless';

export interface StartupEnvironment {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

// ¿Este proceso es un host SIN pantalla? Entonces no crea ventanas, ni tray, ni widget: solo sirve sesiones al
// host local. Con pantalla (Windows, macOS o Linux con DISPLAY/WAYLAND_DISPLAY) arranca como siempre.
export function isHeadlessHost({ platform, argv, env }: StartupEnvironment): boolean {
  if (argv.includes(HEADLESS_FLAG)) return true;
  const hasDisplay = [env['DISPLAY'], env['WAYLAND_DISPLAY']].some((value) => value !== undefined && value.length > 0);
  return platform === 'linux' && !hasDisplay;
}

// Lo que se contesta a quien pide la interfaz gráfica de un host sin pantalla (§3.4): nunca se crea una
// ventana, ni se reinicia, ni se mata una sesión por esa petición.
export const HEADLESS_GUI_UNAVAILABLE =
  'La interfaz gráfica no está disponible en este host iniciado sin pantalla. Para usarla, cierra y vuelve a abrir Mage con pantalla cuando decidas terminar las sesiones activas';

// Lo que dice por stderr la instancia que pierde el lock del perfil. Si la que lo tiene es un host sin pantalla,
// se dice la verdad (§3.4) y NO se promete enfocar una ventana que no existe.
export const ANOTHER_INSTANCE_MESSAGE =
  '[mage] Ya hay otra instancia de Mage con este perfil: esta se cierra y se enfoca la existente. ' +
  'Si esperabas ver tus cambios, cierra la otra (incluido el icono del tray) o arranca con ' +
  '--user-data-dir=<carpeta propia>.';

export function lockFailureMessage(holderMode: 'gui' | 'headless' | null): string {
  return holderMode === 'headless' ? `[mage] ${HEADLESS_GUI_UNAVAILABLE}` : ANOTHER_INSTANCE_MESSAGE;
}

export const NO_SANDBOX_WARNING: StartupWarning = {
  id: 'linux-no-sandbox',
  title: 'Mage se ha iniciado sin el sandbox de Chromium',
  body:
    'El AppImage arranca con --no-sandbox cuando el sistema no permite los espacios de nombres de usuario, y entonces el contenido web no queda aislado. ' +
    'Instala el paquete .deb o activa los espacios de nombres de usuario (sysctl kernel.unprivileged_userns_clone=1 o kernel.apparmor_restrict_unprivileged_userns=0) y vuelve a abrir Mage.',
};

export const HOST_UNAVAILABLE_WARNING_ID = 'host-unavailable';

// El host local no arrancó (H1 de la devolución 16): la interfaz sigue, pero ningún cliente local podrá conectarse.
export function hostUnavailableWarning(reason: string): StartupWarning {
  return {
    id: HOST_UNAVAILABLE_WARNING_ID,
    title: 'El host local de Mage no ha arrancado',
    body:
      'La interfaz funciona con normalidad, pero ningún cliente local (terminal, widget o MCP) podrá conectarse a este Mage hasta que lo cierres y lo vuelvas a abrir. ' +
      `Motivo: ${reason}`,
  };
}

export interface StartupWarningsInput {
  readonly platform: NodeJS.Platform;
  readonly hasNoSandboxSwitch: boolean;
  // Motivo por el que no arrancó el host local, o null si escucha.
  readonly hostFailure: string | null;
}

// Avisos persistentes que el renderer enseña al abrirse: Linux arrancado con el switch no-sandbox y host caído.
export function startupWarnings({ platform, hasNoSandboxSwitch, hostFailure }: StartupWarningsInput): readonly StartupWarning[] {
  const warnings: StartupWarning[] = [];
  if (platform === 'linux' && hasNoSandboxSwitch) warnings.push(NO_SANDBOX_WARNING);
  if (hostFailure !== null) warnings.push(hostUnavailableWarning(hostFailure));
  return warnings;
}
