import { describe, expect, it } from 'vitest';
import { createResultPage } from './resultPage';
const messages = [{ seq: 1, role: 'user', text: 'á🙂' }, { seq: 2, role: 'assistant', text: 'answer' }];
describe('createResultPage', () => {
  it('createResultPage_sinLimiteIncluyeTodo_noTrunca', () => {
    expect(createResultPage({ messages })).toEqual({ messages, nextSeq: 2, truncated: false });
  });
  it.each([{ input: [] }, { input: messages }])('createResultPage_sinMensajesPosteriores_preservaCursor', ({ input }) => {
    expect(createResultPage({ messages: input, afterSeq: 7 })).toEqual({ messages: [], nextSeq: 7, truncated: false });
  });
  it('createResultPage_vaciaSinCursor_empiezaEnCero', () => {
    expect(createResultPage({ messages: [] }).nextSeq).toBe(0);
  });
  it('createResultPage_afterSeq_exclusivo', () => {
    expect(createResultPage({ messages, afterSeq: 1 })).toEqual({ messages: [messages[1]], nextSeq: 2, truncated: false });
  });
  it('createResultPage_unByteNoCabePunto_noConsumeMensaje', () => {
    expect(createResultPage({ messages, maxBytes: 1 })).toEqual({ messages: [], nextSeq: 0, truncated: true });
  });
  it('createResultPage_multibyteParcial_consumePrefijoValidoSinMutar', () => {
    const original = structuredClone(messages);
    const result = createResultPage({ messages, maxBytes: 5 });
    expect(result).toEqual({ messages: [{ seq: 1, role: 'user', text: 'á' }], nextSeq: 1, truncated: true });
    expect(messages).toEqual(original);
    expect(createResultPage({ messages, maxBytes: 6 }).messages[0]?.text).toBe('á🙂');
  });
  it('createResultPage_variosMensajes_presupuestoTotal', () => {
    expect(createResultPage({ messages, maxBytes: 8 })).toEqual({
      messages: [messages[0], { seq: 2, role: 'assistant', text: 'an' }], nextSeq: 2, truncated: true,
    });
  });
  it('createResultPage_limite65536_aceptaExactamente', () => {
    const input = [{ seq: 1, role: 'assistant', text: 'x'.repeat(65_536) }];
    expect(createResultPage({ messages: input, maxBytes: 65_536 })).toEqual({ messages: input, nextSeq: 1, truncated: false });
  });
  it.each([0, -1, 65_537, 1.5, NaN])('createResultPage_presupuestoInvalido_rechaza_%s', (maxBytes) => {
    expect(() => createResultPage({ messages, maxBytes })).toThrow();
  });
});
