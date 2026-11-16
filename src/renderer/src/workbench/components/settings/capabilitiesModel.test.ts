import { describe, expect, it } from 'vitest';
import { entryValueKey, pickClaudeAccount, policyLabelKey } from './capabilitiesModel';

describe('pickClaudeAccount', () => {
  it('pickClaudeAccount_elegidaExiste_esa', () => {
    expect(pickClaudeAccount(['/a', '/b'], '/b', '/a')).toBe('/b');
  });

  it('pickClaudeAccount_sinElegirActivaEsClaude_laActiva', () => {
    expect(pickClaudeAccount(['/a', '/b'], null, '/b')).toBe('/b');
  });

  it('pickClaudeAccount_activaNoEsClaude_laPrimera', () => {
    expect(pickClaudeAccount(['/a', '/b'], null, '/codex')).toBe('/a');
  });

  it('pickClaudeAccount_sinCuentas_null', () => {
    expect(pickClaudeAccount([], null, '/a')).toBeNull();
  });
});

describe('policyLabelKey', () => {
  it('policyLabelKey_conocida_suClave', () => {
    expect(policyLabelKey('allow_routines')).toBe('capabilities.org.policy.allowRoutines');
  });

  it('policyLabelKey_desconocida_null', () => {
    expect(policyLabelKey('allow_cobalt_plinth')).toBeNull();
  });
});

describe('entryValueKey', () => {
  it('entryValueKey_true_activado', () => {
    expect(entryValueKey('true')).toBe('capabilities.org.state.on');
  });

  it('entryValueKey_texto_null', () => {
    expect(entryValueKey('hola')).toBeNull();
  });
});
