import { describe, expect, it } from 'vitest';
import { menuLabelOf, splitModelsByFamily } from './modelMenu';

const model = (label: string, id: string = label): { id: string; label: string } => ({ id, label });
const labels = (list: readonly { label: string }[]): string[] => list.map((m) => m.label);

describe('splitModelsByFamily', () => {
  it('splitModelsByFamily_catalogoClaude_unoPorFamilia', () => {
    const catalog = ['Opus 5.5', 'Sonnet 5.5', 'Fable 5.2', 'Haiku 5.5', 'Fable 5.1', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5', 'Opus 4.8'].map((l) => model(l));

    const { main, more } = splitModelsByFamily(catalog);

    expect(labels(main)).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Fable 5.2', 'Haiku 5.5']);
    expect(labels(more)).toEqual(['Fable 5.1', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5', 'Opus 4.8']);
  });

  it('splitModelsByFamily_etiquetaSinVersion_vaAMain', () => {
    const { main, more } = splitModelsByFamily([model('gpt-5.5-codex'), model('llama3:8b')]);

    expect(labels(main)).toEqual(['gpt-5.5-codex', 'llama3:8b']);
    expect(more).toEqual([]);
  });

  it('splitModelsByFamily_empate_primeroDelCatalogo', () => {
    const { main, more } = splitModelsByFamily([model('Opus 5', 'a'), model('Opus 5', 'b')]);

    expect(main.map((m) => m.id)).toEqual(['a']);
    expect(more.map((m) => m.id)).toEqual(['b']);
  });

  it('splitModelsByFamily_vacio', () => {
    expect(splitModelsByFamily([])).toEqual({ main: [], more: [] });
  });
});

describe('menuLabelOf', () => {
  it('menuLabelOf_conocido_suEtiqueta', () => {
    expect(menuLabelOf([model('Opus 5.5', 'opus')], 'opus')).toBe('Opus 5.5');
  });

  it('menuLabelOf_desconocido_idCrudo', () => {
    expect(menuLabelOf([model('Opus 5.5', 'opus')], 'raro')).toBe('raro');
  });
});
