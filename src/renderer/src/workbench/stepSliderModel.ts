import { EFFORT_LEVELS, isPermissionMode, PERMISSION_MODES, type PermissionMode } from '@shared/ipc';
import { RUNTIME_PERMISSION_MODES, runsOnMageRuntime } from '@shared/providers';
import { codexPermissionPreset } from '@shared/codexPermissions';

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
  ultra: 'Ultra',
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
  if (isPermissionMode(mode)) return PERMISSION_MODE_LABEL[mode];
  if (mode === codexPermissionPreset(':workspace', 'never')) return 'Aprobar automáticamente';
  if (mode === codexPermissionPreset(':danger-full-access', 'never')) return 'Acceso completo';
  if (mode === ':workspace') return 'Solicitar aprobación';
  return CODEX_PROFILE_LABEL[mode] ?? mode;
}

// --- Modos leidos del CLI (respuesta 18) ----------------------------------------------------------

// Proveedores con selector de modo: Claude (su `--permission-mode`), Codex (sus perfiles, sin verificar) y
// los del runtime propio de Mage (P-032: los cinco modos de Mage, sin CLI que sondear).
export function hasPermissionModes(providerId: string): boolean {
  return providerId === 'claude' || providerId === 'codex' || runsOnMageRuntime(providerId);
}

// Modos que rota Shift+Tab en una pestaña: el runtime siempre los cinco; Claude, los que exponga su CLI.
export function permissionCycleForProvider(providerId: string, claudeModes: readonly string[] | null): readonly string[] {
  if (runsOnMageRuntime(providerId)) return RUNTIME_PERMISSION_MODES;
  return providerId === 'claude' ? permissionCycleFor(claudeModes) : [];
}

// Perfiles integrados de `codex app-server` (`permissionProfile/list`, medido en 0.144.4).
const CODEX_PROFILE_LABEL: Readonly<Record<string, string>> = {
  ':read-only': 'Solo lectura',
  ':workspace': 'Espacio de trabajo',
  ':danger-full-access': 'Acceso total',
};

// Pasos del deslizador con los modos QUE EXPONE el CLI: los conocidos en su escala de siempre y los
// nuevos detras, con su nombre crudo. null (el CLI no contesto) = la lista fija de Mage.
export function permissionStepsFor(cliModes: readonly string[] | null): readonly SliderStep[] {
  if (cliModes === null) return permissionSteps;
  const known = PERMISSION_SLIDER_ORDER.filter((mode) => cliModes.includes(mode));
  const unknown = cliModes.filter((mode) => !isPermissionMode(mode));
  return [...known, ...unknown].map((mode) => ({ value: mode, label: permissionModeLabel(mode) }));
}

// Orden del ciclo de Shift+Tab con los modos del CLI (el historico, y los nuevos al final).
export function permissionCycleFor(cliModes: readonly string[] | null): readonly string[] {
  if (cliModes === null) return PERMISSION_MODES;
  return [...PERMISSION_MODES.filter((mode) => cliModes.includes(mode)), ...cliModes.filter((mode) => !isPermissionMode(mode))];
}

// Pasos de Codex: sus perfiles, en el orden que los da (de menos a mas acceso). Sin sondeo, ninguno.
export function codexPermissionSteps(profiles: readonly string[] | null): readonly SliderStep[] {
  return (profiles ?? []).flatMap((profile) => {
    const step = { value: profile, label: permissionModeLabel(profile) };
    if (profile !== ':workspace' && profile !== ':danger-full-access') return [step];
    const value = codexPermissionPreset(profile, 'never');
    return [step, { value, label: permissionModeLabel(value) }];
  });
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

// Geometria del popover: ancho fijo, alto ESTIMADO (solo decide el lado), hueco con el chip y margen
// minimo con los bordes de la ventana.
export const STEP_SLIDER_POPOVER = { widthPx: 264, estimatedHeightPx: 150, gapPx: 4, viewportMarginPx: 8 } as const;

export interface StepSliderPlacement {
  readonly left: number;
  readonly anchor: { readonly top: number } | { readonly bottom: number };
}

// Donde se pinta el popover. Se calcula UNA vez, al abrirlo, con la caja del chip de ese momento: medirlo
// en cada render lo dejaba un paso por detras del chip (la caja era la del render anterior) y, mientras
// esta abierto, cambiar de paso no debe moverlo aunque el chip cambie de ancho.
export function stepSliderPlacement(
  trigger: { readonly top: number; readonly bottom: number; readonly left: number },
  viewport: { readonly width: number; readonly height: number },
): StepSliderPlacement {
  const { widthPx, estimatedHeightPx, gapPx, viewportMarginPx } = STEP_SLIDER_POPOVER;
  const maxLeft = viewport.width - widthPx - viewportMarginPx;
  return {
    left: Math.max(viewportMarginPx, Math.min(trigger.left, maxLeft)),
    anchor: stepSliderAnchor(trigger, estimatedHeightPx, viewport.height, gapPx),
  };
}

// Fraccion del recorrido (0..1) en la que va el pulgar dibujado. Un valor fuera de los pasos (-1) o una
// escala de un solo paso lo dejan a la izquierda: no hay recorrido que repartir.
export function stepFraction(index: number, stepCount: number): number {
  if (index < 0 || stepCount <= 1) return 0;
  return Math.min(index, stepCount - 1) / (stepCount - 1);
}
