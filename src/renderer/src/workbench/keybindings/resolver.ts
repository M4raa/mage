// Resolucion de "que accion dispara esta tecla, ahora mismo" (D5, PLAN-D5-KEYBINDINGS.md §3.2). Modulo
// PURO: recibe el evento + la pila de scopes activos (de mas a menos especifico) + los overrides del
// usuario + el contexto de guards, y devuelve el id de la accion a ejecutar o null. Sin DOM, sin store:
// el caller (componente/hook) hace el `.preventDefault()` y ejecuta la accion.

import type { GuardContext, KeybindingAction, KeybindingScope } from './actionCatalog';
import { KEYBINDING_ACTIONS } from './actionCatalog';
import type { KeyEventLike, ParsedKeyCombo } from './keyParser';
import { isBareAlphanumeric, matchesKeyboardEvent, parseKeyCombo } from './keyParser';

export interface KeybindingOverride {
  readonly actionId: string;
  readonly keys: string;
}

export interface ResolveKeyEventParams {
  readonly event: KeyEventLike;
  // Scopes activos AHORA MISMO, del mas especifico al menos especifico (p.ej. ['prompt'] o ['global']).
  readonly activeScopes: readonly KeybindingScope[];
  readonly overrides: readonly KeybindingOverride[];
  readonly isMac: boolean;
  // ¿El foco esta en un campo de texto editable? Aplica la regla de §3.2 (letra/digito suelto no
  // atraviesa un campo de texto). Pasar `false` cuando el caller ya sabe que no aplica (p.ej. el propio
  // scope `prompt`, donde Tab/Enter deben funcionar dentro del textarea sin que la regla los bloquee).
  readonly focusInEditableText: boolean;
  readonly guardContext: GuardContext;
  // Inyectable para tests; por defecto el catalogo real de la app.
  readonly catalog?: readonly KeybindingAction[];
}

// Combinacion EFECTIVA de una accion: el override del usuario si es valido, si no el default del
// catalogo. Un override presente pero MALFORMADO (combinacion invalida) se trata como "sin override" y
// cae al default — nunca deja la accion sin atajo por un valor corrupto en el fichero (§5).
function effectiveCombo(action: KeybindingAction, overrides: readonly KeybindingOverride[]): ParsedKeyCombo | null {
  const override = overrides.find((o) => o.actionId === action.id);
  const fromOverride = override === undefined ? null : parseKeyCombo(override.keys);
  if (fromOverride !== null) return fromOverride;
  return action.defaultKeys === null ? null : parseKeyCombo(action.defaultKeys);
}

export function resolveKeyEvent(params: ResolveKeyEventParams): string | null {
  const catalog = params.catalog ?? KEYBINDING_ACTIONS;

  for (const scope of params.activeScopes) {
    const candidates = catalog
      .filter((action) => action.scope === scope)
      .map((action) => ({ action, combo: effectiveCombo(action, params.overrides) }))
      .filter((c): c is { action: KeybindingAction; combo: ParsedKeyCombo } => c.combo !== null)
      .filter((c) => matchesKeyboardEvent(c.combo, params.event, params.isMac))
      .filter((c) => !(params.focusInEditableText && isBareAlphanumeric(c.combo)))
      // Las acciones con guard se comprueban ANTES que las que no tienen (p.ej. Shift+Tab en `prompt`:
      // cyclePermissionMode con input vacio manda sobre outdent; si su guard falla, outdent se acepta).
      .sort((a, b) => Number(b.action.guard !== undefined) - Number(a.action.guard !== undefined));

    const picked = candidates.find((c) => c.action.guard === undefined || c.action.guard(params.guardContext));
    if (picked !== undefined) return picked.action.id;
  }
  return null;
}
