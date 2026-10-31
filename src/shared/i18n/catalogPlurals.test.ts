import { describe, expect, it } from 'vitest';
import esCatalog from './catalogs/es.json';
import type { MessageKey } from './messageKeys.generated';
import { createTranslator } from './translator';

const translate = createTranslator('es');
const catalog = esCatalog as Readonly<Record<string, string>>;
const COUNTS = [0, 1, 5] as const;
const PLURAL_KEYS = Object.keys(catalog).filter((key) => catalog[key]!.includes(', plural,'));

// Variables del mensaje: las que son selector de un plural van como número; el resto, como texto 'X'.
function valuesFor(message: string, count: number): Record<string, string | number> {
  const pluralNames = new Set([...message.matchAll(/\{(\w+),\s*plural,/g)].map((m) => m[1]!));
  const names = new Set([...message.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]!));
  const values: Record<string, string | number> = {};
  for (const name of names) values[name] = pluralNames.has(name) ? count : 'X';
  return values;
}

function render(key: string, count: number): string {
  const values = valuesFor(catalog[key]!, count);
  return (translate as (k: string, v: Record<string, string | number>) => string)(key, values);
}

describe('plurales del catálogo', () => {
  it('pluralesDelCatalogo_hayAlgunoQueProbar', () => {
    expect(PLURAL_KEYS.length).toBeGreaterThan(0);
  });

  it('pluralesDelCatalogo_conCeroUnoYMuchos_renderizanSinLlaves', () => {
    for (const key of PLURAL_KEYS) {
      const [zero, one, many] = COUNTS.map((count) => render(key, count));

      for (const text of [zero, one, many]) {
        expect(text, key).not.toBe('');
        expect(text, key).not.toMatch(/[{}]/);
      }
      expect(one, `${key}: 1 debe diferir de 5`).not.toBe(many);
    }
  });

  it('chatThinkingSteps_ceroUnoCinco', () => {
    const key: MessageKey = 'chat.thinking.steps';

    expect(COUNTS.map((count) => translate(key, { count }))).toEqual(['0 pasos', '1 paso', '5 pasos']);
  });

  it('promptQueueImageCount_ceroUnoCinco', () => {
    const key: MessageKey = 'prompt.queue.imageCount';

    expect(COUNTS.map((count) => translate(key, { count }))).toEqual(['0 imágenes', '1 imagen', '5 imágenes']);
  });

  it('chatSubagentsLaunched_uno', () => {
    expect(translate('chat.subagents.launched', { count: 1 })).toBe('Lanzó 1 subagente');
  });

  it('eventsAgyDeniedActionsHeadless_unaYDos', () => {
    const rest = ': sin pantalla no tiene a quién pedir permiso.';

    expect(translate('events.agy.deniedActionsHeadless', { count: 1, names: 'Bash' })).toBe(`agy denegó 1 acción (Bash)${rest}`);
    expect(translate('events.agy.deniedActionsHeadless', { count: 2, names: 'Bash' })).toBe(`agy denegó 2 acciones (Bash)${rest}`);
  });
});
