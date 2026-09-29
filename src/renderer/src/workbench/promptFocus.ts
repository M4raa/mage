// Clic en una zona «muerta» del panel de chat -> el foco vuelve al input (P-028 23). La decision es PURA
// (recibe el evento ya reducido a datos) para poder probarla sin DOM; `ChatPane` la llama en `onClick`.

// Lo que se pide de un elemento: solo `closest` y `contains`, para poder simularlo en un test.
export interface ClickTargetLike {
  closest: (selector: string) => unknown;
}
export interface ClickContainerLike<T> {
  contains: (node: T) => boolean;
}

export interface PromptFocusClick<T extends ClickTargetLike = ClickTargetLike> {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly target: T;
  // El contenedor donde se registro el `onClick` (el panel).
  readonly currentTarget: ClickContainerLike<T>;
  // La seleccion de texto del documento esta colapsada (un clic simple, no un arrastre que selecciona).
  readonly selectionCollapsed: boolean;
}

const PRIMARY_BUTTON = 0;

// Cualquier cosa que ya gestiona su propio foco o su propio clic: enfocar el input se lo quitaria.
const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  'label',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[data-no-refocus]',
  // El propio editor del prompt: ya tiene el foco.
  '.cm-editor',
].join(', ');

export function shouldFocusPromptOnClick<T extends ClickTargetLike>(click: PromptFocusClick<T>): boolean {
  if (click.button !== PRIMARY_BUTTON) return false;
  if (click.ctrlKey || click.shiftKey || click.altKey || click.metaKey) return false;
  // Una seleccion no colapsada es el usuario copiando texto: enfocar el editor la deshace.
  if (!click.selectionCollapsed) return false;
  // Un portal de React propaga el clic al padre React aunque el DOM este fuera del panel.
  if (!click.currentTarget.contains(click.target)) return false;
  return click.target.closest(INTERACTIVE_SELECTOR) === null;
}
