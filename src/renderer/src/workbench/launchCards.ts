import type { LaunchModelOption, LaunchOutcome, MageEvent } from '@shared/events';
import { EFFORT_LEVELS } from '@shared/ipc';
import type { LaunchDelegatedParams } from '@shared/ipc';

// Tarjeta «Lanzar» de una sesión delegada pedida sin modelo o sin esfuerzo. PURO: el estado sale de los eventos que manda
// main a la conversación creadora (`delegation_launch` y `delegation_launch_settled`) y de lo que contesta el IPC.

export interface LaunchCardState {
  readonly childId: string;
  readonly title: string;
  readonly provider: string;
  readonly accountId: string;
  // Lo heredado; null = el por defecto de la cuenta.
  readonly model: string | null;
  readonly effort: string | null;
  readonly models: readonly LaunchModelOption[];
  readonly outcome: LaunchOutcome | null;
  readonly busy: boolean;
  readonly error: string | null;
}

export type LaunchCards = Readonly<Record<string, LaunchCardState>>;
export type LaunchEvent = Extract<MageEvent, { readonly kind: 'delegation_launch' | 'delegation_launch_settled' }>;

// Valor del selector que significa «el de la cuenta» (no se manda nada a main).
export const DEFAULT_CHOICE = '';

export function applyLaunchEvent(cards: LaunchCards, event: LaunchEvent): LaunchCards {
  if (event.kind === 'delegation_launch_settled') return patchLaunchCard(cards, event.childId, { outcome: event.outcome, busy: false, error: null });
  const { kind: _kind, ...card } = event;
  // Repetir el aviso (la misma tarjeta) no pierde lo que ya se contestó.
  const previous = cards[event.childId];
  return { ...cards, [event.childId]: { ...card, outcome: previous?.outcome ?? null, busy: false, error: null } };
}

// Cambia una tarjeta conocida; una que no existe no se inventa.
export function patchLaunchCard(cards: LaunchCards, childId: string, patch: Partial<Pick<LaunchCardState, 'outcome' | 'busy' | 'error'>>): LaunchCards {
  const card = cards[childId];
  if (card === undefined) return cards;
  return { ...cards, [childId]: { ...card, ...patch } };
}

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

// Modelos del selector: «Por defecto», los del catálogo y, si no está en él, el heredado (para que se vea lo que hay).
export function modelOptionsOf(card: LaunchCardState, defaultLabel: string): readonly ChoiceOption[] {
  const listed = card.models.map((model) => ({ value: model.id, label: model.label }));
  const inherited = card.model !== null && !card.models.some((model) => model.id === card.model) ? [{ value: card.model, label: card.model }] : [];
  return [{ value: DEFAULT_CHOICE, label: defaultLabel }, ...listed, ...inherited];
}

// Esfuerzos para el modelo elegido: los que el catálogo mide para él o, sin catálogo, todos; y el heredado si falta.
export function effortOptionsOf(card: LaunchCardState, model: string, defaultLabel: string): readonly ChoiceOption[] {
  const measured = card.models.find((entry) => entry.id === model)?.efforts ?? [];
  const efforts: readonly string[] = measured.length > 0 ? measured : EFFORT_LEVELS;
  const withInherited = card.effort !== null && !efforts.includes(card.effort) ? [...efforts, card.effort] : efforts;
  return [{ value: DEFAULT_CHOICE, label: defaultLabel }, ...withInherited.map((effort) => ({ value: effort, label: effort }))];
}

// Al cambiar de modelo, un esfuerzo que el nuevo no admite vuelve a «Por defecto».
export function effortAfterModelChange(card: LaunchCardState, model: string, effort: string): string {
  const allowed = effortOptionsOf(card, model, '').map((option) => option.value);
  return allowed.includes(effort) ? effort : DEFAULT_CHOICE;
}

export function launchParamsOf(childId: string, choice: { readonly model: string; readonly effort: string }): LaunchDelegatedParams {
  return {
    conversationId: childId,
    ...(choice.model === DEFAULT_CHOICE ? {} : { model: choice.model }),
    ...(choice.effort === DEFAULT_CHOICE ? {} : { effort: choice.effort }),
  };
}

// Es un objeto (no funciones sueltas) para que verify:gui sustituya las llamadas por un espía a través de `__mageDev`.
export const launchCardIpc: {
  launch: (params: LaunchDelegatedParams) => Promise<void>;
  cancel: (conversationId: string) => Promise<void>;
} = {
  launch: (params) => window.mage.launchDelegated(params),
  cancel: (conversationId) => window.mage.cancelDelegatedLaunch(conversationId),
};
