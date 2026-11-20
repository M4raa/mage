import { describe, expect, it } from 'vitest';
import { EFFORT_LEVELS } from '@shared/ipc';
import { DEFAULT_CHOICE, applyLaunchEvent, effortAfterModelChange, effortOptionsOf, launchParamsOf, modelOptionsOf, patchLaunchCard } from './launchCards';
import type { LaunchCards, LaunchEvent } from './launchCards';

const LAUNCH: LaunchEvent = {
  kind: 'delegation_launch', childId: 'pend-1', title: 'Hija', provider: 'claude', accountId: 'acc1', model: 'sonnet', effort: 'high',
  models: [{ id: 'haiku', label: 'Haiku', efforts: ['low'] }, { id: 'sonnet', label: 'Sonnet', efforts: ['low', 'high'] }],
};
const cardOf = (cards: LaunchCards) => {
  const card = cards['pend-1'];
  if (card === undefined) throw new Error('falta la tarjeta pend-1');
  return card;
};

describe('applyLaunchEvent', () => {
  it('applyLaunchEvent_aviso_creaTarjetaSinContestar', () => {
    const cards = applyLaunchEvent({}, LAUNCH);
    expect(cardOf(cards)).toMatchObject({ title: 'Hija', model: 'sonnet', effort: 'high', outcome: null, busy: false, error: null });
  });
  it('applyLaunchEvent_contestada_guardaElResultado', () => {
    const cards = applyLaunchEvent(applyLaunchEvent({}, LAUNCH), { kind: 'delegation_launch_settled', childId: 'pend-1', outcome: { launched: false } });
    expect(cardOf(cards).outcome).toEqual({ launched: false });
  });
  it('applyLaunchEvent_contestadaDesconocida_noInventaTarjeta', () => {
    const cards = applyLaunchEvent({}, { kind: 'delegation_launch_settled', childId: 'otra', outcome: { launched: false } });
    expect(cards).toEqual({});
  });
  it('applyLaunchEvent_avisoRepetido_conservaLaRespuesta', () => {
    const settled = patchLaunchCard(applyLaunchEvent({}, LAUNCH), 'pend-1', { outcome: { launched: false } });
    expect(cardOf(applyLaunchEvent(settled, LAUNCH)).outcome).toEqual({ launched: false });
  });
});

describe('opciones de la tarjeta', () => {
  const card = cardOf(applyLaunchEvent({}, LAUNCH));
  it('modelOptionsOf_catalogo_porDefectoYLosDelCatalogo', () => {
    expect(modelOptionsOf(card, 'Por defecto').map((option) => option.value)).toEqual([DEFAULT_CHOICE, 'haiku', 'sonnet']);
  });
  it('modelOptionsOf_heredadoFueraDelCatalogo_loAnade', () => {
    expect(modelOptionsOf({ ...card, model: 'opus' }, '').map((option) => option.value)).toEqual([DEFAULT_CHOICE, 'haiku', 'sonnet', 'opus']);
  });
  it('effortOptionsOf_modeloConCatalogo_susEsfuerzos', () => {
    expect(effortOptionsOf(card, 'sonnet', '').map((option) => option.value)).toEqual([DEFAULT_CHOICE, 'low', 'high']);
  });
  it('effortOptionsOf_sinCatalogo_todosLosNiveles', () => {
    expect(effortOptionsOf({ ...card, models: [], effort: null }, DEFAULT_CHOICE, '').map((option) => option.value)).toEqual([DEFAULT_CHOICE, ...EFFORT_LEVELS]);
  });
  it('effortAfterModelChange_noAdmitido_vuelveAPorDefecto', () => {
    expect(effortAfterModelChange({ ...card, effort: null }, 'haiku', 'high')).toBe(DEFAULT_CHOICE);
  });
  it('effortAfterModelChange_admitido_seMantiene', () => {
    expect(effortAfterModelChange(card, 'haiku', 'low')).toBe('low');
  });
});

describe('launchParamsOf', () => {
  it('launchParamsOf_porDefecto_noMandaNada', () => {
    expect(launchParamsOf('pend-1', { model: DEFAULT_CHOICE, effort: DEFAULT_CHOICE })).toEqual({ conversationId: 'pend-1' });
  });
  it('launchParamsOf_elegidos_losManda', () => {
    expect(launchParamsOf('pend-1', { model: 'haiku', effort: 'low' })).toEqual({ conversationId: 'pend-1', model: 'haiku', effort: 'low' });
  });
});
