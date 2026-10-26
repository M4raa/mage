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

export interface StartupWarning {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const NO_SANDBOX_WARNING: StartupWarning = {
  id: 'linux-no-sandbox',
  title: 'Mage se ha iniciado sin el sandbox de Chromium',
  body:
    'El AppImage arranca con --no-sandbox cuando el sistema no permite los espacios de nombres de usuario, y entonces el contenido web no queda aislado. ' +
    'Instala el paquete .deb o activa los espacios de nombres de usuario (sysctl kernel.unprivileged_userns_clone=1 o kernel.apparmor_restrict_unprivileged_userns=0) y vuelve a abrir Mage.',
};

// Avisos persistentes que el renderer enseña al abrirse. Hoy, uno: Linux arrancado con el switch no-sandbox.
export function startupWarnings({ platform, hasNoSandboxSwitch }: { platform: NodeJS.Platform; hasNoSandboxSwitch: boolean }): readonly StartupWarning[] {
  return platform === 'linux' && hasNoSandboxSwitch ? [NO_SANDBOX_WARNING] : [];
}
