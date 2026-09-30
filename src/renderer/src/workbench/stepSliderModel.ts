import { EFFORT_LEVELS, isPermissionMode, PERMISSION_MODES, type PermissionMode } from '@shared/ipc';

// Datos PUROS de los selectores de pasos (P-028 32/33): modo de permiso y esfuerzo se eligen con un
// deslizador de pasos (`StepSlider`); aqui viven sus pasos, etiquetas y el mapeo posicion <-> valor, sin
// nada de React, para probarlos aparte.

export interface SliderStep {
  readonly value: string;
  readonly label: string;
}

// Posicion de un valor en los pasos, o -1 si no esta (un modo desconocido que reporta el CLI).
export function stepIndexOf(steps: readonly SliderStep[], value: string): number {
  return steps.findIndex((step) => step.value === value);
}

// Valor del paso en una posicion. Una posicion fuera de rango es un bug del llamante: falla con el valor.
export function stepValueAt(steps: readonly SliderStep[], index: number): string {
  const step = steps[index];
  if (step === undefined) throw new Error(`Posicion de paso invalida: ${JSON.stringify(index)} (hay ${steps.length} pasos)`);
  return step.value;
}

// --- Esfuerzo -------------------------------------------------------------------------------------

// '' = sin fijar -> default del CLI ("Auto"), siempre a la izquierda del todo.
export const EFFORT_STEP_LABEL: Readonly<Record<string, string>> = {
  '': 'Auto',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo',
};

// Pasos de esfuerzo de un proveedor: 'Auto' y sus niveles (Claude, los cinco de `EFFORT_LEVELS`; `agy`, tres).
export function effortSteps(levels: readonly string[] = EFFORT_LEVELS): readonly SliderStep[] {
  return ['', ...levels].map((value) => ({ value, label: EFFORT_STEP_LABEL[value] ?? value }));
}

// --- Modo de permiso ------------------------------------------------------------------------------

// Etiqueta corta de cada modo (chip, slider y Ajustes).
export const PERMISSION_MODE_LABEL: Readonly<Record<PermissionMode, string>> = {
  default: 'Manual',
  acceptEdits: 'Aceptar ediciones',
  plan: 'Plan',
  auto: 'Auto',
  bypassPermissions: 'Omitir permisos',
};

// De «mas control» a «mas autonomia». NO es el orden del ciclo de Shift+Tab (`PERMISSION_MODES`): ahi el
// orden es historico; en el deslizador tiene que leerse como una escala.
export const PERMISSION_SLIDER_ORDER: readonly PermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'];

// Los mismos cinco modos que el ciclo, ni uno mas ni uno menos (si `PERMISSION_MODES` gana uno, esto avisa).
if (PERMISSION_SLIDER_ORDER.length !== PERMISSION_MODES.length) {
  throw new Error(`PERMISSION_SLIDER_ORDER (${PERMISSION_SLIDER_ORDER.length}) no casa con PERMISSION_MODES (${PERMISSION_MODES.length})`);
}

export const permissionSteps: readonly SliderStep[] = PERMISSION_SLIDER_ORDER.map((mode) => ({
  value: mode,
  label: PERMISSION_MODE_LABEL[mode],
}));

// Etiqueta del modo por defecto de Ajustes: '' = el de la cuenta, y despues los cinco modos del chat.
export const DEFAULT_PERMISSION_MODE_ACCOUNT_LABEL = 'De la cuenta';
export const defaultPermissionSteps: readonly SliderStep[] = [{ value: '', label: DEFAULT_PERMISSION_MODE_ACCOUNT_LABEL }, ...permissionSteps];

// Un modo que Mage no ofrece (el CLI puede estar en `dontAsk`) se enseña con su nombre crudo.
export function permissionModeLabel(mode: string): string {
  return isPermissionMode(mode) ? PERMISSION_MODE_LABEL[mode] : mode;
}

// Donde nace el popover respecto a su chip. El alto real no se conoce hasta montarlo (depende de si
// lleva nota), asi que el alto ESTIMADO solo decide el lado. Debajo se ancla por `top`; encima, por
// `bottom` —el borde que toca al chip—, para que un popover mas bajo que la estimacion no quede
// despegado (medido con verify:gui: 29 y 52 px de hueco anclando por `top`).
export function stepSliderAnchor(
  trigger: { readonly top: number; readonly bottom: number },
  estimatedHeight: number,
  viewportHeight: number,
  gap: number,
): { readonly top: number } | { readonly bottom: number } {
  if (trigger.bottom + estimatedHeight + gap <= viewportHeight) return { top: trigger.bottom + gap };
  return { bottom: viewportHeight - trigger.top + gap };
}
