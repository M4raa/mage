// `pnpm verify:gui` en segundo plano: la ventana de la app de prueba no salta delante de la del usuario mientras
// trabaja. Solo con la app SIN empaquetar y la variable puesta por el harness; una instalada la ignora siempre.
export const BACKGROUND_TEST_ENV = 'MAGE_TEST_BACKGROUND';

// Hueco entre la ventana y el borde izquierdo de la pantalla más a la izquierda.
const OFFSCREEN_MARGIN_PX = 200;

// Switches de Chromium para que una ventana fuera de pantalla siga pintando a su ritmo: sin ellos, Windows la da por
// tapada y Chromium deja de producir frames (rAF parado, capturas que no llegan, animaciones congeladas).
export const BACKGROUND_TEST_SWITCHES: readonly (readonly [string, string?])[] = [
  ['disable-features', 'CalculateNativeWinOcclusion'],
  ['disable-renderer-backgrounding'],
  ['disable-background-timer-throttling'],
  ['disable-backgrounding-occluded-windows'],
];

export function isBackgroundTestRun(packaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return !packaged && env[BACKGROUND_TEST_ENV] === '1';
}

export interface DisplayBounds {
  readonly x: number;
  readonly y: number;
}

// Posición a la izquierda de TODAS las pantallas (también las que quedan a la izquierda de la principal).
export function offScreenPosition(displays: readonly DisplayBounds[], windowWidth: number): { readonly x: number; readonly y: number } {
  if (displays.length === 0) throw new Error('Sin pantallas para colocar la ventana de prueba');
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) throw new Error(`Ancho de ventana no valido: ${windowWidth}`);
  const left = Math.min(...displays.map((display) => display.x));
  const top = Math.min(...displays.map((display) => display.y));
  return { x: left - windowWidth - OFFSCREEN_MARGIN_PX, y: top };
}
