import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import type { ProviderAdapter } from './providerAdapter';
import { emitLine, fakeAdapter, harness, written } from './agentSession.harness';

// Proveedor con modelo/esfuerzo/modo como flags de arranque (`agy`): se guardan y el siguiente mensaje, con la
// sesion en reposo, relanza el CLI reanudando la conversacion.
function launchFlagAdapter() {
  const base = fakeAdapter();
  const adapter: ProviderAdapter = { ...base.adapter, launchFlagSettings: true, encodeInitialize: undefined, encodeGetContextUsage: undefined };
  return { adapter, plans: base.plans };
}

const INIT: MageEvent = {
  kind: 'session_init', sessionId: 'agy-conv-9', model: 'gemini', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [],
};
const RESULT: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };

describe('AgentSession con ajustes de arranque', () => {
  it('setModel_sesionEnReposo_relanzaConElModeloNuevoYLaMismaConversacion', () => {
    const fake = launchFlagAdapter();
    const h = harness(fake);
    h.session.start();
    emitLine(h.children[0]!, [INIT, RESULT]);

    h.session.setModel('gemini-nuevo');
    h.session.setEffort('high');
    h.session.setPermissionMode('plan');
    h.session.sendUserMessage('sigue');

    expect(h.children).toHaveLength(2);
    expect(h.treeKills).toHaveLength(1);
    expect(fake.plans[1]).toMatchObject({ model: 'gemini-nuevo', effort: 'high', permissionMode: 'plan', resume: true, conversationId: 'agy-conv-9' });
    expect(written(h.children[1]!)).toEqual([{ text: 'sigue' }]);
    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
  });

  it('setModel_turnoEnCurso_noCortaElProcesoHastaQueTermine', () => {
    const fake = launchFlagAdapter();
    const h = harness(fake);
    h.session.start();
    emitLine(h.children[0]!, [INIT]);
    h.session.sendUserMessage('largo');

    h.session.setModel('gemini-nuevo');
    h.session.sendUserMessage('encolado');

    expect(h.children).toHaveLength(1);
    expect(h.treeKills).toHaveLength(0);

    emitLine(h.children[0]!, [RESULT]);
    h.session.sendUserMessage('despues');

    expect(h.children).toHaveLength(2);
    expect(fake.plans[1]?.model).toBe('gemini-nuevo');
  });

  it('setEffort_vacio_quitaElEsfuerzoDelRelanzado', () => {
    const fake = launchFlagAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.setEffort('');
    h.session.sendUserMessage('hola');

    expect(fake.plans[1]?.effort).toBeUndefined();
  });

  it('setModel_sinCambiosDespues_noRelanzaDeNuevo', () => {
    const fake = launchFlagAdapter();
    const h = harness(fake);
    h.session.start();
    emitLine(h.children[0]!, [INIT, RESULT]);
    h.session.setModel('gemini-nuevo');
    h.session.sendUserMessage('uno');
    emitLine(h.children[1]!, [RESULT]);

    h.session.sendUserMessage('dos');

    expect(h.children).toHaveLength(2);
  });
});
