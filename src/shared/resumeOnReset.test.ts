import { describe, expect, it } from 'vitest';
import { supportsResumeOnReset } from './resumeOnReset';

describe('supportsResumeOnReset', () => {
  it('supportsResumeOnReset_claudePorSuscripcion_true', () => {
    expect(supportsResumeOnReset('claude', 'subscription')).toBe(true);
  });
  it('supportsResumeOnReset_claudePorApi_false', () => {
    expect(supportsResumeOnReset('claude', 'api-key')).toBe(false);
  });
  it.each(['codex', 'agy', 'runtime', ''])('supportsResumeOnReset_%s_false', (provider) => {
    expect(supportsResumeOnReset(provider, 'subscription')).toBe(false);
  });
  it('supportsResumeOnReset_cuentaDesconocida_false', () => {
    expect(supportsResumeOnReset('claude', undefined)).toBe(false);
  });
});
