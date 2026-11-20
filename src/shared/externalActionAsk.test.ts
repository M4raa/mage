import { describe, expect, it } from 'vitest';
import { EXTERNAL_ACTION_ASK_RULES, mergeClaudeSettings, withExternalActionAsk } from './externalActionAsk';

describe('withExternalActionAsk', () => {
  it('withExternalActionAsk_auto_añadeLasReglas', () => {
    // Arrange
    const settings = { ultracode: true };
    // Act
    const result = withExternalActionAsk(settings, 'auto');
    // Assert
    expect(result).toEqual({ ultracode: true, permissions: { ask: [...EXTERNAL_ACTION_ASK_RULES] } });
    expect(EXTERNAL_ACTION_ASK_RULES).toContain('Bash(git push:*)');
    expect(EXTERNAL_ACTION_ASK_RULES).toContain('Artifact');
  });

  it('withExternalActionAsk_modoSinDefinir_añadeLasReglas', () => {
    expect(withExternalActionAsk({}, undefined)).toEqual({ permissions: { ask: [...EXTERNAL_ACTION_ASK_RULES] } });
  });

  it('withExternalActionAsk_bypass_sinCambios', () => {
    // Arrange
    const settings = { ultracode: true, permissions: { ask: ['Bash(rm:*)'] } };
    // Act
    const result = withExternalActionAsk(settings, 'bypassPermissions');
    // Assert
    expect(result).toBe(settings);
  });

  it('withExternalActionAsk_conAskDelUsuario_lasConserva', () => {
    // Arrange
    const settings = { permissions: { ask: ['Bash(rm:*)'], allow: ['Read'], defaultMode: 'acceptEdits' } };
    // Act
    const result = withExternalActionAsk(settings, 'acceptEdits');
    // Assert
    expect(result).toEqual({ permissions: { ask: ['Bash(rm:*)', ...EXTERNAL_ACTION_ASK_RULES], allow: ['Read'], defaultMode: 'acceptEdits' } });
  });

  it('withExternalActionAsk_reglaRepetida_unaVez', () => {
    // Arrange
    const settings = { permissions: { ask: ['Bash(git push:*)', 'Artifact'] } };
    // Act
    const ask = (withExternalActionAsk(settings, 'default').permissions as { ask: string[] }).ask;
    // Assert
    expect(ask.filter((rule) => rule === 'Bash(git push:*)')).toHaveLength(1);
    expect(ask.filter((rule) => rule === 'Artifact')).toHaveLength(1);
    expect(ask).toHaveLength(EXTERNAL_ACTION_ASK_RULES.length);
  });

  it('withExternalActionAsk_askQueNoEsLista_lanzaConElValor', () => {
    expect(() => withExternalActionAsk({ permissions: { ask: 'Artifact' } }, 'auto')).toThrow('"Artifact"');
  });
});

describe('mergeClaudeSettings', () => {
  it('mergeClaudeSettings_soloElFragmentoTraePermisos_losConserva', () => {
    // Arrange
    const fragment = { hooks: { Stop: [] }, permissions: { deny: ['WebFetch'] } };
    // Act
    const result = mergeClaudeSettings(fragment, { ultracode: true });
    // Assert
    expect(result).toEqual({ hooks: { Stop: [] }, permissions: { deny: ['WebFetch'] }, ultracode: true });
  });

  it('mergeClaudeSettings_losDosTraenPermisos_mezclaCamposYUneAsk', () => {
    // Arrange
    const fragment = { permissions: { deny: ['WebFetch'], ask: ['Bash(rm:*)'] } };
    // Act
    const result = mergeClaudeSettings(fragment, { permissions: { ask: ['Artifact', 'Bash(rm:*)'] } });
    // Assert
    expect(result).toEqual({ permissions: { deny: ['WebFetch'], ask: ['Bash(rm:*)', 'Artifact'] } });
  });

  it('mergeClaudeSettings_vacios_objetoVacio', () => {
    expect(mergeClaudeSettings({}, {})).toEqual({});
  });
});
