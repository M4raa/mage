import { EFFORT_LEVELS, isPermissionMode, PERMISSION_MODES, type PermissionMode } from '@shared/ipc';
import { AGY_PERMISSION_MODES, AGY_PROVIDER_ID, RUNTIME_PERMISSION_MODES, runsOnMageRuntime } from '@shared/providers';
import { codexPermissionPreset } from '@shared/codexPermissions';
import { t } from '../i18n/uiLanguage';

// Datos PUROS de los selectores de pasos (P-028 32/33): modo de permiso y esfuerzo se eligen con un
// deslizador de pasos (`StepSlider`); aqui viven sus pasos, etiquetas y el mapeo posicion <-> valor, sin
// nada de React, para probarlos aparte.

export interface SliderStep {
  readonly value: string;
  readonly label: string;
}

// Paso cuya etiqueta se traduce al LEERLA: hay pasos que son constantes del módulo (o que PromptBar memoiza) y su
// etiqueta tiene que seguir al idioma activo, no al del momento en que se crearon.
function translatedStep(value: string, label: () => string): SliderStep {
  return {
    value,
    get label() {
      return label();
    },
  };
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

type EffortStepLabelKey =
  | 'prompt.effort.step.auto'
  | 'prompt.effort.step.low'
  | 'prompt.effort.step.medium'
  | 'prompt.effort.step.high'
  | 'prompt.effort.step.xhigh'
  | 'prompt.effort.step.max'
  | 'prompt.effort.step.ultra';

// '' = sin fijar -> default del CLI ("Auto"), siempre a la izquierda del todo. Guarda la CLAVE: se traduce al pintar.
const EFFORT_STEP_LABEL_KEY: Readonly<Record<string, EffortStepLabelKey>> = {
  '': 'prompt.effort.step.auto',
  low: 'prompt.effort.step.low',
  medium: 'prompt.effort.step.medium',
  high: 'prompt.effort.step.high',
  xhigh: 'prompt.effort.step.xhigh',
  max: 'prompt.effort.step.max',
  ultra: 'prompt.effort.step.ultra',
};

// Etiqueta de un nivel de esfuerzo; un nivel que Mage no conoce se enseña con su nombre crudo.
export function effortStepLabel(value: string): string {
  const key = EFFORT_STEP_LABEL_KEY[value];
  return key === undefined ? value : t(key);
}

// Pasos de esfuerzo de un proveedor: 'Auto' y sus niveles (Claude, los cinco de `EFFORT_LEVELS`; `agy`, tres).
export function effortSteps(levels: readonly string[] = EFFORT_LEVELS): readonly SliderStep[] {
  return ['', ...levels].map((value) => ({ value, label: effortStepLabel(value) }));
}

// --- Modo de permiso ------------------------------------------------------------------------------

// Etiqueta corta de cada modo (chip, slider y Ajustes). Guarda la CLAVE: se traduce al pintar.
const PERMISSION_MODE_LABEL_KEY: Readonly<
  Record<PermissionMode, 'prompt.permission.mode.default' | 'prompt.permission.mode.acceptEdits' | 'prompt.permission.mode.plan' | 'prompt.permission.mode.auto' | 'prompt.permission.mode.bypassPermissions'>
> = {
  default: 'prompt.permission.mode.default',
  acceptEdits: 'prompt.permission.mode.acceptEdits',
  plan: 'prompt.permission.mode.plan',
  auto: 'prompt.permission.mode.auto',
  bypassPermissions: 'prompt.permission.mode.bypassPermissions',
};

// De «mas control» a «mas autonomia». NO es el orden del ciclo de Shift+Tab (`PERMISSION_MODES`): ahi el
// orden es historico; en el deslizador tiene que leerse como una escala.
export const PERMISSION_SLIDER_ORDER: readonly PermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'];

// Los mismos cinco modos que el ciclo, ni uno mas ni uno menos (si `PERMISSION_MODES` gana uno, esto avisa).
if (PERMISSION_SLIDER_ORDER.length !== PERMISSION_MODES.length) {
  throw new Error(`PERMISSION_SLIDER_ORDER (${PERMISSION_SLIDER_ORDER.length}) no casa con PERMISSION_MODES (${PERMISSION_MODES.length})`);
}

export const permissionSteps: readonly SliderStep[] = PERMISSION_SLIDER_ORDER.map((mode) => translatedStep(mode, () => permissionModeLabel(mode)));

// Etiqueta del modo por defecto de Ajustes: '' = el de la cuenta, y despues los cinco modos del chat.
export function defaultPermissionModeAccountLabel(): string {
  return t('prompt.permission.mode.fromAccount');
}
export const defaultPermissionSteps: readonly SliderStep[] = [translatedStep('', defaultPermissionModeAccountLabel), ...permissionSteps];

// Un modo que Mage no ofrece (el CLI puede estar en `dontAsk`) se enseña con su nombre crudo.
export function permissionModeLabel(mode: string): string {
  if (isPermissionMode(mode)) return t(PERMISSION_MODE_LABEL_KEY[mode]);
  if (mode === codexPermissionPreset(':workspace', 'never')) return t('prompt.permission.codex.autoApprove');
  if (mode === codexPermissionPreset(':danger-full-access', 'never')) return t('prompt.permission.codex.fullAccess');
  if (mode === ':workspace') return t('prompt.permission.codex.requestApproval');
  const key = CODEX_PROFILE_LABEL_KEY[mode];
  return key === undefined ? mode : t(key);
}

// --- Modos leidos del CLI (respuesta 18) ----------------------------------------------------------

// Proveedores con selector de modo: Claude (su `--permission-mode`), Codex (sus perfiles, sin verificar) y
// los del runtime propio de Mage (P-032: los cinco modos de Mage, sin CLI que sondear) y agy (solo `acceptEdits` y `plan`).
export function hasPermissionModes(providerId: string): boolean {
  return providerId === 'claude' || providerId === 'codex' || providerId === AGY_PROVIDER_ID || runsOnMageRuntime(providerId);
}

// Modos que rota Shift+Tab en una pestaña: el runtime siempre los cinco; Claude, los que exponga su CLI.
export function permissionCycleForProvider(providerId: string, claudeModes: readonly string[] | null): readonly string[] {
  if (runsOnMageRuntime(providerId)) return RUNTIME_PERMISSION_MODES;
  return providerId === 'claude' ? permissionCycleFor(claudeModes) : [];
}

// Modo en el que arranca una pestaña sin modo elegido: agy corre en `accept-edits` (su `--mode` por defecto en Mage).
export function defaultModeOf(providerId: string): string {
  return providerId === AGY_PROVIDER_ID ? 'acceptEdits' : 'default';
}

// Codex sin modo elegido: Mage no le manda `permissions` y el hilo arranca en `:read-only` (medido en
// `spike/codex-sandbox-spike.mjs`, codex-cli 0.164.0). Respuesta 1 de la devolución 16: se queda así por defecto,
// como Claude, que también pregunta antes de editar, y la pestaña lo enseña con un clic para pasar a `:workspace`.
export const CODEX_DEFAULT_PROFILE = ':read-only';
export const CODEX_WRITE_PROFILE = ':workspace';

export function effectiveCodexMode(mode: string | undefined): string {
  return mode === undefined || mode === '' ? CODEX_DEFAULT_PROFILE : mode;
}

// Pasos de agy: su `--mode` solo admite `accept-edits` y `plan`.
export const agyPermissionSteps: readonly SliderStep[] = AGY_PERMISSION_MODES.map((mode) => translatedStep(mode, () => permissionModeLabel(mode)));

// Perfiles integrados de `codex app-server` (`permissionProfile/list`, medido en 0.144.4).
const CODEX_PROFILE_LABEL_KEY: Readonly<Record<string, 'prompt.permission.codex.readOnly' | 'prompt.permission.codex.workspace' | 'prompt.permission.codex.dangerFullAccess'>> = {
  ':read-only': 'prompt.permission.codex.readOnly',
  ':workspace': 'prompt.permission.codex.workspace',
  ':danger-full-access': 'prompt.permission.codex.dangerFullAccess',
};

// Los tres perfiles de serie de Codex: los de Ajustes antes de que Codex se haya sondeado (P-038).
export const CODEX_BUILTIN_PROFILES: readonly string[] = Object.keys(CODEX_PROFILE_LABEL_KEY);

// Pasos del deslizador con los modos QUE EXPONE el CLI: los conocidos en su escala de siempre y los
// nuevos detras, con su nombre crudo. null (el CLI no contesto) = la lista fija de Mage.
export function permissionStepsFor(cliModes: readonly string[] | null): readonly SliderStep[] {
  if (cliModes === null) return permissionSteps;
  const known = PERMISSION_SLIDER_ORDER.filter((mode) => cliModes.includes(mode));
  const unknown = cliModes.filter((mode) => !isPermissionMode(mode));
  return [...known, ...unknown].map((mode) => translatedStep(mode, () => permissionModeLabel(mode)));
}

// Orden del ciclo de Shift+Tab con los modos del CLI (el historico, y los nuevos al final).
export function permissionCycleFor(cliModes: readonly string[] | null): readonly string[] {
  if (cliModes === null) return PERMISSION_MODES;
  return [...PERMISSION_MODES.filter((mode) => cliModes.includes(mode)), ...cliModes.filter((mode) => !isPermissionMode(mode))];
}

// Pasos de Codex: sus perfiles, en el orden que los da (de menos a mas acceso). Sin sondeo, ninguno.
export function codexPermissionSteps(profiles: readonly string[] | null): readonly SliderStep[] {
  return (profiles ?? []).flatMap((profile) => {
    const step = translatedStep(profile, () => permissionModeLabel(profile));
    if (profile !== ':workspace' && profile !== ':danger-full-access') return [step];
    const value = codexPermissionPreset(profile, 'never');
    return [step, translatedStep(value, () => permissionModeLabel(value))];
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
