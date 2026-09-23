// Deteccion de conflictos al GUARDAR un override (D5, PLAN-D5-KEYBINDINGS.md §7). Modulo PURO. El preset
// base (catalogo) sale del codigo, revisado y sin conflictos por construccion (incluye el par guardado
// Shift+Tab de `prompt`: outdent/cyclePermissionMode, mutuamente excluyentes por guard, nunca pasan por
// aqui como candidato-contra-el-otro). Este modulo solo entra en juego cuando el usuario intenta fijar
// un override nuevo: dos acciones en el MISMO scope con la MISMA combinacion efectiva es una ambiguedad
// real (nada en el modelo de scopes la resuelve) y se rechaza en la UI, nunca "gana la ultima" en silencio.

import type { KeybindingAction } from './actionCatalog';
import { KEYBINDING_ACTIONS } from './actionCatalog';
import type { KeybindingOverride } from './resolver';
import { parseKeyCombo } from './keyParser';

export interface KeybindingConflict {
  readonly actionId: string; // la otra accion que ya ocupa esa combinacion en ese scope
}

export interface FindConflictParams {
  readonly actionId: string; // accion que el usuario esta a punto de rebindar
  readonly keys: string; // combinacion candidata, formato canonico
  readonly overrides: readonly KeybindingOverride[]; // overrides ACTUALES (sin aplicar aun el candidato)
  readonly catalog?: readonly KeybindingAction[]; // inyectable para tests
}

// Combinacion efectiva de una accion dada su lista de overrides (mismo criterio que resolver.ts: override
// valido > default > null). Duplicado deliberadamente pequeno aqui para no crear una dependencia circular
// con resolver.ts por una funcion de 3 lineas.
function effectiveKeys(action: KeybindingAction, overrides: readonly KeybindingOverride[]): string | null {
  const override = overrides.find((o) => o.actionId === action.id);
  if (override !== undefined && parseKeyCombo(override.keys) !== null) return override.keys;
  return action.defaultKeys;
}

// ¿La combinacion candidata choca con OTRA accion del mismo scope? Combinaciones entre scopes distintos
// son validas por diseño (la resolucion por especificidad ya las desambigua, §3.2): esta funcion nunca
// compara entre scopes.
export function findConflict(params: FindConflictParams): KeybindingConflict | null {
  const catalog = params.catalog ?? KEYBINDING_ACTIONS;
  const candidateAction = catalog.find((a) => a.id === params.actionId);
  if (candidateAction === undefined) return null;
  const candidateCombo = parseKeyCombo(params.keys);
  if (candidateCombo === null) return null; // combinacion invalida: nada que chocar, se rechaza aparte

  const sameScope = catalog.filter((a) => a.scope === candidateAction.scope && a.id !== candidateAction.id);
  for (const other of sameScope) {
    const otherKeys = effectiveKeys(other, params.overrides);
    if (otherKeys === null) continue;
    const otherCombo = parseKeyCombo(otherKeys);
    if (otherCombo === null) continue;
    if (
      otherCombo.code === candidateCombo.code &&
      otherCombo.cmdOrCtrl === candidateCombo.cmdOrCtrl &&
      otherCombo.alt === candidateCombo.alt &&
      otherCombo.shift === candidateCombo.shift
    ) {
      return { actionId: other.id };
    }
  }
  return null;
}
