import type { MageEvent } from '@shared/events';
import { describe, expect, it } from 'vitest';
import { SessionSettingsRegistry, settingsOfLaunch } from './sessionSettingsRegistry';

const BASE = { provider: 'claude', model: 'sonnet', effort: 'high', permissionMode: 'plan' };

function registryWith(sessionId = 'viejo'): SessionSettingsRegistry {
  const registry = new SessionSettingsRegistry();
  registry.record(sessionId, BASE);
  return registry;
}

describe('SessionSettingsRegistry', () => {
  it('record_yGet_devuelveLoAnotado', () => {
    expect(registryWith().get('viejo')).toEqual(BASE);
  });

  it('get_sesionDesconocida_null', () => {
    expect(new SessionSettingsRegistry().get('nada')).toBeNull();
  });

  it('apply_modelo_loCambiaYConservaElResto', () => {
    const registry = registryWith();

    registry.apply('viejo', 'model', 'opus');

    expect(registry.get('viejo')).toEqual({ ...BASE, model: 'opus' });
  });

  it('apply_esfuerzoVacio_loDejaAusente', () => {
    const registry = registryWith();

    registry.apply('viejo', 'effort', '');

    expect(registry.get('viejo')).not.toHaveProperty('effort');
    expect(registry.get('viejo')).toHaveProperty('model', 'sonnet');
  });

  it('apply_sesionDesconocida_noCreaEntrada', () => {
    const registry = new SessionSettingsRegistry();

    registry.apply('nada', 'model', 'opus');

    expect(registry.get('nada')).toBeNull();
  });

  it('observe_permissionMode_actualizaElModo', () => {
    const registry = registryWith();

    registry.observe('viejo', { kind: 'permission_mode', mode: 'acceptEdits' });

    expect(registry.get('viejo')?.permissionMode).toBe('acceptEdits');
  });

  it('observe_conversationReset_copiaAlIdNuevo', () => {
    const registry = registryWith();

    registry.observe('viejo', { kind: 'conversation_reset', newSessionId: 'nuevo' });

    expect(registry.get('nuevo')).toEqual(registry.get('viejo'));
    expect(registry.get('viejo')).toEqual(BASE);
  });

  it('observe_otroEvento_noCambiaNada', () => {
    const registry = registryWith();
    const event: MageEvent = { kind: 'queue_changed', queue: [] };

    registry.observe('viejo', event);

    expect(registry.get('viejo')).toEqual(BASE);
  });
});

describe('settingsOfLaunch', () => {
  it('settingsOfLaunch_sinEsfuerzoNiModo_losOmite', () => {
    const settings = settingsOfLaunch({ provider: 'claude', model: 'sonnet' });

    expect(settings).toEqual({ provider: 'claude', model: 'sonnet' });
    expect(settings).not.toHaveProperty('effort');
    expect(settings).not.toHaveProperty('permissionMode');
  });

  it('settingsOfLaunch_esfuerzoVacio_loOmite', () => {
    expect(settingsOfLaunch({ provider: 'claude', model: 'sonnet', effort: '' })).not.toHaveProperty('effort');
  });
});
