import { describe, expect, it } from 'vitest';
import type { Block } from './types';
import type { TextState } from './promptEditing';
import { historyDown, historyUp, IDLE_PROMPT_HISTORY, sentPrompts, type PromptHistoryState } from './promptHistory';

const user = (id: string, text: string): Block => ({ kind: 'user', id, text, time: '10:00', attachments: [], nativeId: null });
const agent = (id: string): Block => ({ kind: 'agent', id, runs: [], streaming: false });
const caretEnd = (value: string): TextState => ({ value, selectionStart: value.length, selectionEnd: value.length });
const caretStart = (value: string): TextState => ({ value, selectionStart: 0, selectionEnd: 0 });
const browsingAt = (index: number, savedDraft = ''): PromptHistoryState => ({ index, savedDraft });

describe('sentPrompts', () => {
  it('sentPrompts_bloquesMezclados_soloUsuarioDelMasRecienteAlMasAntiguo', () => {
    const blocks = [user('1', 'uno'), agent('a'), user('2', 'dos'), agent('b'), user('3', 'tres')];
    expect(sentPrompts(blocks)).toEqual(['tres', 'dos', 'uno']);
  });

  it('sentPrompts_vaciosYRepetidosSeguidos_seQuitan', () => {
    const blocks = [user('1', 'uno'), user('2', '   '), user('3', 'uno'), user('4', 'dos'), user('5', 'dos')];
    expect(sentPrompts(blocks)).toEqual(['dos', 'uno']);
  });
});

describe('historyUp', () => {
  it('historyUp_borradorVacio_traeElUltimoConCursorAlPrincipio', () => {
    const move = historyUp(['b', 'a'], IDLE_PROMPT_HISTORY, caretEnd(''));
    expect(move).toEqual({ state: { index: 0, savedDraft: '' }, text: caretStart('b') });
  });

  it('historyUp_mostrandoUno_traeElAnterior', () => {
    const move = historyUp(['b', 'a'], browsingAt(0, 'borrador'), caretStart('b'));
    expect(move).toEqual({ state: { index: 1, savedDraft: 'borrador' }, text: caretStart('a') });
  });

  it('historyUp_enElMasAntiguo_null', () => {
    expect(historyUp(['b', 'a'], browsingAt(1), caretStart('a'))).toBeNull();
  });

  it('historyUp_borradorConTexto_null', () => {
    expect(historyUp(['b', 'a'], IDLE_PROMPT_HISTORY, caretStart('escribo'))).toBeNull();
  });

  it('historyUp_cursorEnLaSegundaLinea_null', () => {
    const state: TextState = { value: 'x\ny', selectionStart: 3, selectionEnd: 3 };
    expect(historyUp(['x\ny', 'a'], browsingAt(0), state)).toBeNull();
  });

  it('historyUp_sinMensajes_null', () => {
    expect(historyUp([], IDLE_PROMPT_HISTORY, caretEnd(''))).toBeNull();
  });

  it('historyUp_recordadoEditado_null', () => {
    expect(historyUp(['b', 'a'], browsingAt(0), caretStart('b editado'))).toBeNull();
  });
});

describe('historyDown', () => {
  it('historyDown_sinRecorrer_null', () => {
    expect(historyDown(['b', 'a'], IDLE_PROMPT_HISTORY, caretEnd(''))).toBeNull();
  });

  it('historyDown_enElMasReciente_reponeElBorradorDeAntes', () => {
    const move = historyDown(['b', 'a'], browsingAt(0, 'borrador'), caretEnd('b'));
    expect(move).toEqual({ state: IDLE_PROMPT_HISTORY, text: caretEnd('borrador') });
  });

  it('historyDown_mostrandoElAnterior_traeElSiguienteConCursorAlFinal', () => {
    const move = historyDown(['b', 'a'], browsingAt(1, 'borrador'), caretEnd('a'));
    expect(move).toEqual({ state: { index: 0, savedDraft: 'borrador' }, text: caretEnd('b') });
  });

  it('historyDown_cursorFueraDeLaUltimaLinea_null', () => {
    const state: TextState = { value: 'x\ny', selectionStart: 0, selectionEnd: 0 };
    expect(historyDown(['x\ny'], browsingAt(0), state)).toBeNull();
  });
});
