import { EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { announcesSomething, buildPromptDecorations, createAnnouncementCleaner } from './promptExtensions';

// Temporizador de prueba: guarda la función programada y cuenta las cancelaciones.
function fakeTimer() {
  const pending: (() => void)[] = [];
  const cancelled = vi.fn();
  const setTimer = (fn: () => void): (() => void) => {
    pending.push(fn);
    return () => {
      cancelled();
      pending.splice(pending.indexOf(fn), 1);
    };
  };
  return { pending, cancelled, setTimer };
}

describe('announcesSomething', () => {
  it('announcesSomething_transaccionConAnuncio_true', () => {
    const state = EditorState.create({ doc: 'x' });

    expect(announcesSomething([state.update({ effects: EditorView.announce.of('Selection deleted') })])).toBe(true);
  });

  it('announcesSomething_sinAnuncio_false', () => {
    const state = EditorState.create({ doc: 'x' });

    expect(announcesSomething([state.update({ changes: { from: 0, insert: 'a' } })])).toBe(false);
  });
});

describe('createAnnouncementCleaner', () => {
  it('createAnnouncementCleaner_trasElPlazo_limpia', () => {
    const timer = fakeTimer();
    const clear = vi.fn();
    const cleaner = createAnnouncementCleaner({ clear, setTimer: timer.setTimer, delayMs: 10 });

    cleaner.onAnnounce();
    expect(clear).not.toHaveBeenCalled();
    timer.pending[0]!();

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('createAnnouncementCleaner_dosAnunciosSeguidos_soloUnaLimpiezaConElUltimoPlazo', () => {
    const timer = fakeTimer();
    const clear = vi.fn();
    const cleaner = createAnnouncementCleaner({ clear, setTimer: timer.setTimer, delayMs: 10 });

    cleaner.onAnnounce();
    cleaner.onAnnounce();

    expect(timer.cancelled).toHaveBeenCalledTimes(1);
    expect(timer.pending).toHaveLength(1);
  });

  it('createAnnouncementCleaner_dispose_cancelaLaPendiente', () => {
    const timer = fakeTimer();
    const cleaner = createAnnouncementCleaner({ clear: vi.fn(), setTimer: timer.setTimer, delayMs: 10 });

    cleaner.onAnnounce();
    cleaner.dispose();

    expect(timer.cancelled).toHaveBeenCalledTimes(1);
    expect(timer.pending).toHaveLength(0);
  });
});

interface Seen { readonly from: number; readonly to: number; readonly widget: boolean }

function seen(set: DecorationSet): readonly Seen[] {
  const out: Seen[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    out.push({ from, to, widget: value.spec.widget !== undefined });
  });
  return out;
}

// Las decoraciones de LÍNEA (sangría francesa de las listas) con su estilo.
function lineStyles(set: DecorationSet): readonly { readonly from: number; readonly style: string }[] {
  const out: { from: number; style: string }[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, _to, value) => {
    const attributes = value.spec.attributes as Record<string, string> | undefined;
    if (value.spec.class === 'cm-mg-list-line') out.push({ from, style: attributes?.style ?? '' });
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

  it('buildPromptDecorations_listaSangrada_lineaConSangriaFrancesaDeSuCabeza', () => {
    const sets = buildPromptDecorations(stateAt('hola\n  - uno\n3. dos', 0));

    expect(lineStyles(sets.all)).toEqual([
      { from: 5, style: 'padding-left: 2.2em; text-indent: -2.2em' },
      { from: 13, style: 'padding-left: 1.65em; text-indent: -1.65em' },
    ]);
  });

  it('buildPromptDecorations_textoSinLista_sinSangria', () => {
    expect(lineStyles(buildPromptDecorations(stateAt('hola\nadios', 0)).all)).toEqual([]);
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
