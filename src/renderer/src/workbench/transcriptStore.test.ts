import { afterEach, describe, expect, it, vi } from 'vitest';
import { foreignText, USER_FACING_MARK, UserFacingError } from '@shared/i18n/localizedText';
import type { TranscriptBatch, TranscriptEntry } from '@shared/transcripts';
import { applyTranscriptBatch, disposeTranscriptStore, transcriptStoreForTab, type TranscriptStoreState } from './transcriptStore';
import { makeEntry } from '@testing/transcriptEntry';

// Estado minimo que necesita el acumulador (el resto del store no interviene).
type Accumulated = Pick<TranscriptStoreState, 'transcriptId' | 'entries' | 'errors'>;

function entry(index: number): TranscriptEntry {
  return makeEntry({ index });
}

function batch(entries: readonly TranscriptEntry[], isFinal = false, overrides: Partial<TranscriptBatch> = {}): TranscriptBatch {
  return { entries, errors: [], isFinal, totalLinesSoFar: entries.length, bytesReadSoFar: 0, rawLineNumber: entries.length, ...overrides };
}

const EMPTY: Accumulated = { transcriptId: 'lectura-1', entries: [], errors: [] };

describe('applyTranscriptBatch', () => {
  it('applyTranscriptBatch_loteDeLaLecturaActiva_acumulaSusEntradas', () => {
    const patch = applyTranscriptBatch(EMPTY, { transcriptId: 'lectura-1', batch: batch([entry(0), entry(1)]) });

    expect(patch.entries).toHaveLength(2);
    expect(patch.isFinal).toBe(false);
    expect(patch.totalLinesSoFar).toBe(2);
  });

  it('applyTranscriptBatch_loteDeOtraLectura_devuelveParcheVacio', () => {
    // Otra instancia del store, o una apertura ya reemplazada: su lote no puede entrar aqui.
    const patch = applyTranscriptBatch(EMPTY, { transcriptId: 'otra', batch: batch([entry(0)]) });

    expect(patch).toEqual({});
  });

  it('applyTranscriptBatch_dosLotesSeguidos_noPierdeElPrimero', () => {
    // La carrera del hallazgo 8: con `getState()` antes de `setState`, dos lotes del mismo tick
    // escribian sobre la MISMA instantanea y el segundo se llevaba por delante las entradas del
    // primero. Encadenar los parches es exactamente lo que hace el actualizador funcional.
    const first = applyTranscriptBatch(EMPTY, { transcriptId: 'lectura-1', batch: batch([entry(0)]) });
    const afterFirst: Accumulated = { ...EMPTY, entries: first.entries ?? [], errors: first.errors ?? [] };

    const second = applyTranscriptBatch(afterFirst, { transcriptId: 'lectura-1', batch: batch([entry(1)], true) });

    expect(second.entries?.map((e) => e.index)).toEqual([0, 1]);
    expect(second.isFinal).toBe(true);
  });

  it('applyTranscriptBatch_error_cierraLaCargaConElMensaje', () => {
    const patch = applyTranscriptBatch(EMPTY, { transcriptId: 'lectura-1', error: 'no existe el fichero' });

    expect(patch).toEqual({ errorMessage: 'no existe el fichero', isFinal: true, missing: false });
  });

  it('applyTranscriptBatch_conversacionInexistente_loMarcaComoMissing', () => {
    const patch = applyTranscriptBatch(EMPTY, { transcriptId: 'lectura-1', error: 'No existe la conversacion de Codex x', missing: true });

    expect(patch).toEqual({ errorMessage: 'No existe la conversacion de Codex x', isFinal: true, missing: true });
  });

  it('applyTranscriptBatch_sinLoteNiError_noCambiaNada', () => {
    expect(applyTranscriptBatch(EMPTY, { transcriptId: 'lectura-1' })).toEqual({});
  });

  it('applyTranscriptBatch_sinLecturaActiva_ignoraElLote', () => {
    const patch = applyTranscriptBatch({ ...EMPTY, transcriptId: null }, { transcriptId: 'lectura-1', batch: batch([entry(0)]) });

    expect(patch).toEqual({});
  });

  it('applyTranscriptBatch_I5_propagaLaPosicionDeReanudacionDelLote', () => {
    const patch = applyTranscriptBatch(EMPTY, {
      transcriptId: 'lectura-1',
      batch: batch([entry(0)], true, { bytesReadSoFar: 42, rawLineNumber: 7, totalLinesSoFar: 5 }),
    });

    expect(patch.tailPosition).toEqual({ bytesRead: 42, rawLineNumber: 7, totalLinesSoFar: 5 });
  });
});

// 4.1: el registro por pestaña. Lo que hay que garantizar es que dos paneles NO comparten lectura (es
// lo que hacia que el panel no enfocado de un split no hidratase, 4.3) y que cerrar la pestaña suelta
// su store (misma fuga que B12). En Node no hay `window`, asi que el store se crea sin suscripcion al
// canal — justo el camino que el guard de entorno del modulo protege.
describe('transcriptStoreForTab', () => {
  it('transcriptStoreForTab_mismaPestana_devuelveLaMismaInstancia', () => {
    expect(transcriptStoreForTab('tab-1')).toBe(transcriptStoreForTab('tab-1'));
  });

  it('transcriptStoreForTab_pestanasDistintas_devuelveInstanciasIndependientes', () => {
    const a = transcriptStoreForTab('tab-a');
    const b = transcriptStoreForTab('tab-b');

    expect(a).not.toBe(b);
    a.setState({ lastParams: { accountDir: 'd', cwd: 'c', sessionId: 's-a' } });

    // La clave de 4.3: el panel de `tab-b` no ve la sesion que abrio el de `tab-a`.
    expect(b.getState().lastParams).toBeNull();
  });

  it('disposeTranscriptStore_pestanaCerrada_laSiguienteLecturaEmpiezaLimpia', () => {
    const antes = transcriptStoreForTab('tab-cerrada');
    antes.setState({ entries: [entry(0)] });

    disposeTranscriptStore('tab-cerrada');
    const despues = transcriptStoreForTab('tab-cerrada');

    expect(despues).not.toBe(antes);
    expect(despues.getState().entries).toEqual([]);
  });

  it('disposeTranscriptStore_pestanaDesconocida_noLanza', () => {
    expect(() => disposeTranscriptStore('nunca-existio')).not.toThrow();
  });
});


describe('A10 — reemplazo de historial truncado', () => {
  it('reset_reemplazaEntradasYErrores_yElLoteSiguienteAcumula', () => {
    const current: Accumulated = { transcriptId: 'lectura-1', entries: [entry(7)], errors: [{ lineNumber: 9, message: 'anterior' }] };
    const reset = { transcriptId: 'lectura-1', batch: batch([entry(0)], false, { reset: true, bytesReadSoFar: 42, rawLineNumber: 1 }) };
    expect(applyTranscriptBatch(current, { ...reset, transcriptId: 'otra' })).toEqual({});
    const patch = applyTranscriptBatch(current, reset);
    expect(patch.entries).toEqual([entry(0)]);
    expect(patch.errors).toEqual([]);
    expect(patch.tailPosition).toEqual({ bytesRead: 42, rawLineNumber: 1, totalLinesSoFar: 1 });
    const next = applyTranscriptBatch({ ...current, ...patch }, { transcriptId: 'lectura-1', batch: batch([entry(1)]) });
    expect(next.entries).toEqual([entry(0), entry(1)]);
  });

  it('resetAVacio_borraTambienErroresYCheckpoint', () => {
    const current: Accumulated = { transcriptId: 'lectura-1', entries: [entry(7)], errors: [{ lineNumber: 9, message: 'anterior' }] };
    const patch = applyTranscriptBatch(current, { transcriptId: 'lectura-1', batch: batch([], true, { reset: true }) });
    expect(patch.entries).toEqual([]);
    expect(patch.errors).toEqual([]);
    expect(patch.totalLinesSoFar).toBe(0);
    expect(patch.tailPosition).toEqual({ bytesRead: 0, rawLineNumber: 0, totalLinesSoFar: 0 });
  });
});

describe('open — error de main', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('open_errorUserFacingDeMain_textoSinMarca', async () => {
    const ipcError = new Error("Error invoking remote method 'x': Error: " + new UserFacingError(foreignText('hola')).message);
    const store = transcriptStoreForTab('tab-error-main'); // antes del stub: sin `window` no se suscribe al canal
    vi.stubGlobal('window', { mage: { openTranscript: vi.fn().mockRejectedValue(ipcError), cancelTranscript: vi.fn() } });

    await store.getState().open({ accountDir: 'd', cwd: 'c', sessionId: 's' });

    expect(store.getState().errorMessage).toBe('hola');
    expect(store.getState().errorMessage).not.toContain(USER_FACING_MARK);
  });
});
