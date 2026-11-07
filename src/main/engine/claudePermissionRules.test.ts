import { describe, expect, it } from 'vitest';
import { allowRulesOf, allowScopesFor, formatRule, updatedPermissionsFor } from './claudePermissionRules';

// Sugerencias MEDIDAS con el CLI 2.1.319.
const MEASURED = [
  { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'mkdir probe-a *' }], behavior: 'allow', destination: 'localSettings' },
  { type: 'addDirectories', directories: ['C:\\tmp\\x'], destination: 'session' },
  { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
];

const BASH = { toolName: 'Bash', input: { command: 'mkdir a' }, requiresUserInteraction: false, suppressAlwaysAllow: false };

describe('allowRulesOf', () => {
  it('allowRulesOf_sugerenciasMedidas_soloLasDeAddRules', () => {
    expect(allowRulesOf(MEASURED, 'Bash')).toEqual([{ toolName: 'Bash', ruleContent: 'mkdir probe-a *' }]);
  });

  it.each([undefined, [], 'x'])('allowRulesOf_sinSugerencias_laHerramientaEntera_%s', (suggestions) => {
    expect(allowRulesOf(suggestions, 'Write')).toEqual([{ toolName: 'Write' }]);
  });

  it('allowRulesOf_addRulesDeDenegar_seIgnora', () => {
    const deny = [{ type: 'addRules', behavior: 'deny', rules: [{ toolName: 'Bash', ruleContent: 'rm *' }] }];
    expect(allowRulesOf(deny, 'Bash')).toEqual([{ toolName: 'Bash' }]);
  });
});

describe('formatRule', () => {
  it('formatRule_conYSinContenido', () => {
    expect(formatRule({ toolName: 'Bash', ruleContent: 'mkdir probe-a *' })).toBe('Bash(mkdir probe-a *)');
    expect(formatRule({ toolName: 'Write' })).toBe('Write');
  });
});

describe('allowScopesFor', () => {
  it('allowScopesFor_bashNormal_sesionYSiempre', () => {
    expect(allowScopesFor(BASH)).toEqual(['session', 'always']);
  });

  it('allowScopesFor_bashDeLaBarreraDePr_ninguno', () => {
    expect(allowScopesFor({ ...BASH, input: { command: 'git push origin main' } })).toEqual([]);
  });

  it('allowScopesFor_pregunta_ninguno', () => {
    expect(allowScopesFor({ ...BASH, requiresUserInteraction: true })).toEqual([]);
  });

  it('allowScopesFor_suprimidoPorElCli_ninguno', () => {
    expect(allowScopesFor({ ...BASH, suppressAlwaysAllow: true })).toEqual([]);
  });
});

describe('updatedPermissionsFor', () => {
  const rules = [{ toolName: 'Bash', ruleContent: 'mkdir a *' }];

  it('updatedPermissionsFor_sesion_destinoSession', () => {
    expect(updatedPermissionsFor(rules, 'session')).toEqual([{ type: 'addRules', rules, behavior: 'allow', destination: 'session' }]);
  });

  it('updatedPermissionsFor_siempre_destinoUserSettings', () => {
    expect(updatedPermissionsFor(rules, 'always')).toEqual([{ type: 'addRules', rules, behavior: 'allow', destination: 'userSettings' }]);
  });

  it('updatedPermissionsFor_sinReglas_lanza', () => {
    expect(() => updatedPermissionsFor([], 'always')).toThrow(/always/);
  });
});
