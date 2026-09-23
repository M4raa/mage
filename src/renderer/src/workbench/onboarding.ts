import { KEYBINDING_ACTIONS } from './keybindings/actionCatalog';
import { displayKeyCombo, parseKeyCombo } from './keybindings/keyParser';
import { ONBOARDING_VERSION } from '@shared/settings';
import type { AppSettings, KeybindingOverride } from '@shared/settings';

// Logica PURA del asistente de primer arranque. Sin DOM y sin IPC -> se prueba en Vitest; la pantalla
// (OnboardingWizard.tsx) solo pinta lo que sale de aqui.

export const ONBOARDING_STEPS = ['engine', 'appearance', 'shortcuts'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// ¿Hay que enseñar el asistente? Solo si el usuario NO ha completado esta version. Se compara por
// version y no por booleano para poder volver a enseñarlo una sola vez cuando gane un paso nuevo.
export function shouldShowOnboarding(settings: AppSettings): boolean {
  return settings.onboardingCompletedVersion < ONBOARDING_VERSION;
}

// Siguiente/anterior paso, o null en los extremos. El llamante decide que hacer con el null (cerrar el
// asistente al avanzar desde el ultimo, no hacer nada al retroceder desde el primero).
export function stepAfter(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null;
}

export function stepBefore(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index <= 0 ? null : (ONBOARDING_STEPS[index - 1] ?? null);
}

// Los atajos que se enseñan en el ultimo paso. Son los SEIS que hacen falta para moverse el primer
// dia; el resto se descubre en Configuracion. Se citan por id del catalogo (nunca con las teclas
// escritas a mano) para que enseñen lo que de verdad esta cableado, incluidos los cambios del usuario.
const ESSENTIAL_ACTION_IDS: readonly string[] = [
  'conversation.new',
  'app.openSettings',
  'prompt.send',
  'session.interrupt',
  'app.toggleSidebar',
  'tab.close',
];

export interface ShortcutHint {
  readonly actionId: string;
  readonly label: string;
  readonly keys: string; // ya en formato legible para esta plataforma
}

// Atajos esenciales con sus teclas EFECTIVAS (el override del usuario si lo hay, si no el default del
// catalogo). Un id que ya no exista en el catalogo —o una combinacion que no se puede interpretar— se
// omite en vez de pintarse a medias: la chuleta del primer dia no puede enseñar un atajo que no existe.
export function essentialShortcuts(overrides: readonly KeybindingOverride[], isMac: boolean): readonly ShortcutHint[] {
  const overrideById = new Map(overrides.map((override) => [override.actionId, override.keys]));
  const hints: ShortcutHint[] = [];
  for (const actionId of ESSENTIAL_ACTION_IDS) {
    const action = KEYBINDING_ACTIONS.find((candidate) => candidate.id === actionId);
    if (action === undefined) continue;
    const keys = overrideById.get(actionId) ?? action.defaultKeys;
    if (keys === null) continue; // accion sin atajo por defecto y sin override: no hay nada que enseñar
    const parsed = parseKeyCombo(keys);
    if (parsed === null) continue;
    hints.push({ actionId, label: action.label, keys: displayKeyCombo(parsed, isMac) });
  }
  return hints;
}

// Comando de instalacion del CLI de cada motor, para el paso 1 cuando no esta instalado. Mage NO lo
// ejecuta por su cuenta: instalar un paquete global en la maquina del usuario es cosa del usuario, y
// un `npm install -g` lanzado desde la app falla de formas (permisos, PATH, gestor de paquetes
// distinto) que la app no sabe explicar. Se enseña el comando, se copia, y se vuelve a comprobar.
export const ENGINE_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
};

export function installCommandFor(providerId: string): string | null {
  return ENGINE_INSTALL_COMMANDS[providerId] ?? null;
}
