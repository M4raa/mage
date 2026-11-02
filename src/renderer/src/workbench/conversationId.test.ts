import { describe, expect, it } from 'vitest';
import { conversationIdOfTab } from './conversationId';

describe('conversationIdOfTab', () => {
  it('conversationIdOfTab_codexConSesionViva_devuelveElHilo', () => {
    expect(conversationIdOfTab({ provider: 'codex', resumeSessionId: 'thread-1' }, 'mage-uuid')).toBe('thread-1');
  });

  it('conversationIdOfTab_agyConSesionViva_devuelveElHilo', () => {
    expect(conversationIdOfTab({ provider: 'agy', resumeSessionId: 'cascade-1' }, 'mage-uuid')).toBe('cascade-1');
  });

  it('conversationIdOfTab_codexSinHilo_undefinedAunqueHayaSesionViva', () => {
    expect(conversationIdOfTab({ provider: 'codex' }, 'mage-uuid')).toBeUndefined();
  });

  it('conversationIdOfTab_claudeConSesionViva_devuelveLaViva', () => {
    expect(conversationIdOfTab({ provider: 'claude', resumeSessionId: 'old' }, 'live')).toBe('live');
  });

  it('conversationIdOfTab_runtimePropioSinSesionViva_devuelveLaQueReanuda', () => {
    expect(conversationIdOfTab({ provider: 'custom:ollama', resumeSessionId: 'old' }, undefined)).toBe('old');
  });

  it('conversationIdOfTab_claudeSinNada_undefined', () => {
    expect(conversationIdOfTab({ provider: 'claude' }, undefined)).toBeUndefined();
  });
});
