import { describe, expect, it, vi } from 'vitest';
import type { ConversationLockRef } from '@shared/conversationLock';
import { runLockHeartbeatTick } from './conversationLockHeartbeat';

const REF: ConversationLockRef = { provider: 'claude', accountDir: '/home/u/.claude', nativeId: 'c1' };
const OTHER: ConversationLockRef = { ...REF, nativeId: 'c2' };

describe('runLockHeartbeatTick', () => {
  it('tick_heartbeatLanza_loRegistraYNoEscapa', () => {
    const log = vi.fn();
    const notifyLost = vi.fn();

    expect(() => runLockHeartbeatTick({ heartbeat: () => { throw new Error('EPERM: rename'); }, log, notifyLost })).not.toThrow();

    expect(log).toHaveBeenCalledWith('error', expect.any(String), { error: 'EPERM: rename' });
    expect(notifyLost).not.toHaveBeenCalled();
  });

  it('tick_unaFallaYOtraSePerdio_registraElFalloSinAvisarYAvisaLaPerdida', () => {
    const log = vi.fn();
    const notifyLost = vi.fn();

    runLockHeartbeatTick({ heartbeat: () => ({ lost: [OTHER], failed: [{ ref: REF, error: new Error('EPERM') }] }), log, notifyLost });

    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('No se pudo renovar'), { provider: 'claude', nativeId: 'c1', error: 'EPERM' });
    expect(notifyLost).toHaveBeenCalledTimes(1);
    expect(notifyLost).toHaveBeenCalledWith(OTHER);
  });

  it('tick_sinNovedades_noRegistraNada', () => {
    const log = vi.fn();

    runLockHeartbeatTick({ heartbeat: () => ({ lost: [], failed: [] }), log, notifyLost: vi.fn() });

    expect(log).not.toHaveBeenCalled();
  });

  it('tick_avisoDePerdidaLanza_loRegistraYNoEscapa', () => {
    const log = vi.fn();
    const notifyLost = vi.fn(() => { throw new Error('ventana destruida'); });

    expect(() => runLockHeartbeatTick({ heartbeat: () => ({ lost: [REF], failed: [] }), log, notifyLost })).not.toThrow();

    expect(log).toHaveBeenCalledWith('error', expect.any(String), { error: 'ventana destruida' });
  });
});
