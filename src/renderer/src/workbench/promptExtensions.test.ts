import { EditorState } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { buildPromptDecorations } from './promptExtensions';

interface Seen { readonly from: number; readonly to: number; readonly widget: boolean }

function seen(set: DecorationSet): readonly Seen[] {
  const out: Seen[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    out.push({ from, to, widget: value.spec.widget !== undefined });
  });
  return out;
}

const stateAt = (doc: string, cursor: number): EditorState => EditorState.create({ doc, selection: { anchor: cursor } });

describe('buildPromptDecorations', () => {
  it.each([['delante', 0], ['dentro', 1], ['detras', 5]] as const)('buildPromptDecorations_vinetaConCursor%s_esWidgetAtomico', (_, cursor) => {
    const sets = buildPromptDecorations(stateAt('- uno', cursor));

    expect(seen(sets.atomic)).toEqual([{ from: 0, to: 2, widget: true }]);
    expect(seen(sets.all)).toContainEqual({ from: 0, to: 2, widget: true });
  });

  it('buildPromptDecorations_vinetaEnOtraLinea_esAtomica', () => {
    const sets = buildPromptDecorations(stateAt('hola\n- uno', 0));

    expect(seen(sets.atomic)).toEqual([{ from: 5, to: 7, widget: true }]);
  });

  it('buildPromptDecorations_asteriscoYMas_dosVinetasAtomicas', () => {
    const sets = buildPromptDecorations(stateAt('* a\n+ b', 0));

    expect(seen(sets.atomic)).toEqual([{ from: 0, to: 2, widget: true }, { from: 4, to: 6, widget: true }]);
  });

  it('buildPromptDecorations_listaNumerada_numeroEsMarcaYNoAtomico', () => {
    const sets = buildPromptDecorations(stateAt('1. uno', 6));

    expect(seen(sets.atomic)).toEqual([]);
    expect(seen(sets.all)).toContainEqual({ from: 0, to: 3, widget: false });
  });

  it('buildPromptDecorations_textoSinLista_sinAtomicos', () => {
    const sets = buildPromptDecorations(stateAt('hola', 4));

    expect(seen(sets.atomic)).toEqual([]);
  });

  it('buildPromptDecorations_documentoVacio_sinDecoraciones', () => {
    const sets = buildPromptDecorations(stateAt('', 0));

    expect(seen(sets.all)).toEqual([]);
    expect(seen(sets.atomic)).toEqual([]);
  });
});
