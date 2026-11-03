import { describe, expect, it } from 'vitest';
import { PromptDesk } from './promptDesk.mjs';

const p = (requestId) => ({ kind: 'permission', requestId });

describe('PromptDesk', () => {
  it('offer_primero_shown', () => {
    const desk = new PromptDesk();

    expect(desk.offer(p('a'))).toBe('shown');
    expect(desk.active()).toEqual(p('a'));
  });

  it('offer_segundo_queued', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));

    expect(desk.offer(p('b'))).toBe('queued');
    expect(desk.active()).toEqual(p('a'));
  });

  it('offer_repetido_duplicate', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));
    desk.offer(p('b'));

    expect(desk.offer(p('a'))).toBe('duplicate');
    expect(desk.offer(p('b'))).toBe('duplicate');
  });

  it('resolve_activo_promueveElSiguiente', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));
    desk.offer(p('b'));

    expect(desk.resolve('a')).toEqual({ wasActive: true, next: p('b') });
    expect(desk.active()).toEqual(p('b'));
    expect(desk.resolve('b')).toEqual({ wasActive: true, next: null });
    expect(desk.active()).toBeNull();
  });

  it('resolve_enEspera_noTocaElActivo', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));
    desk.offer(p('b'));

    expect(desk.resolve('b')).toEqual({ wasActive: false, next: null });
    expect(desk.active()).toEqual(p('a'));
    expect(desk.resolve('a')).toEqual({ wasActive: true, next: null });
  });

  it('resolve_desconocido_nada', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));

    expect(desk.resolve('zzz')).toEqual({ wasActive: false, next: null });
    expect(desk.active()).toEqual(p('a'));
  });

  it('replaceActive_otroRequestId_lanza', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));

    expect(() => desk.replaceActive(p('b'))).toThrow('El prompt activo es a y se intentó sustituir por b');
  });

  it('replaceActive_sinActivo_lanza', () => {
    expect(() => new PromptDesk().replaceActive(p('a'))).toThrow('No hay ninguna petición activa que sustituir');
  });

  it('clear_vaciaTodo', () => {
    const desk = new PromptDesk();
    desk.offer(p('a'));
    desk.offer(p('b'));

    desk.clear();

    expect(desk.active()).toBeNull();
    expect(desk.offer(p('b'))).toBe('shown');
  });
});
