// Lógica pura del menú de modelo (B1): qué modelos van en la lista principal y cuáles en «Más modelos».
import type { ModelOption } from './models';

// «Familia X.Y»: «Opus 5.5», «Fable 5.2», «Haiku 4.5», «Sonnet 5».
const FAMILY_VERSION_LABEL = /^(\S+)\s+(\d+(?:\.\d+)?)$/;

export interface ModelMenuSplit {
  readonly main: readonly ModelOption[];
  readonly more: readonly ModelOption[];
}

// Por familia, el de versión MÁS ALTA va a `main` (empate: el primero del catálogo); el resto a `more`.
// Una etiqueta sin forma «Familia versión» (un modelo de Codex, de un endpoint propio) va siempre a `main`.
// Ambas listas conservan el orden del catálogo.
export function splitModelsByFamily(models: readonly ModelOption[]): ModelMenuSplit {
  const best = new Map<string, { readonly id: string; readonly version: number }>();
  for (const model of models) {
    const parsed = FAMILY_VERSION_LABEL.exec(model.label);
    if (parsed === null) continue;
    const family = parsed[1] as string;
    const version = Number(parsed[2]);
    const current = best.get(family);
    if (current === undefined || version > current.version) best.set(family, { id: model.id, version });
  }
  const main: ModelOption[] = [];
  const more: ModelOption[] = [];
  for (const model of models) {
    const parsed = FAMILY_VERSION_LABEL.exec(model.label);
    const isMain = parsed === null || best.get(parsed[1] as string)?.id === model.id;
    (isMain ? main : more).push(model);
  }
  return { main, more };
}

// Etiqueta del modelo actual, o su id crudo si el catálogo no lo conoce.
export function menuLabelOf(models: readonly ModelOption[], modelId: string): string {
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}
