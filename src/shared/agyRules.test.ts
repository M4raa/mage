import { describe, expect, it } from 'vitest';
import { agyLinkedPaths, setAgyCommandVerdict, toAgyPermissionRules, validateAgyCommand, validateAgyLinkPath } from './agyRules';

describe('validateAgyCommand', () => {
  it('validateAgyCommand_conEspacios_recortaYConservaLaLineaExacta', () => {
    expect(validateAgyCommand('  git status > s.txt ')).toEqual({ ok: true, command: 'git status > s.txt' });
  });

  it.each(['', '   ', 'git status\nrm -rf /', 'regex:^rm .*'])('validateAgyCommand_invalido_%#_loRechazaConMotivo', (input) => {
    expect(validateAgyCommand(input)).toMatchObject({ ok: false, message: expect.any(String) as unknown as string });
  });
});

describe('setAgyCommandVerdict', () => {
  const rules = { allow: ['git status'], deny: ['rm -rf build'] };

  it('setAgyCommandVerdict_permitirUnDenegado_loPasaDeDenyAAllow', () => {
    expect(setAgyCommandVerdict(rules, 'rm -rf build', 'allow')).toEqual({ allow: ['git status', 'rm -rf build'], deny: [] });
  });

  it('setAgyCommandVerdict_denegarUnPermitido_loPasaDeAllowADeny', () => {
    expect(setAgyCommandVerdict(rules, ' git status ', 'deny')).toEqual({ allow: [], deny: ['rm -rf build', 'git status'] });
  });

  it('setAgyCommandVerdict_permitirElQueYaEsta_noLoRepite', () => {
    expect(setAgyCommandVerdict(rules, 'git status', 'allow')).toEqual(rules);
  });

  it('setAgyCommandVerdict_null_loQuitaDeLasDos', () => {
    expect(setAgyCommandVerdict(rules, 'rm -rf build', null)).toEqual({ allow: ['git status'], deny: [] });
  });

  it('setAgyCommandVerdict_comandoInvalido_lanzaConElValor', () => {
    expect(() => setAgyCommandVerdict(rules, 'regex:.*', 'allow')).toThrow(/regex:\.\*/);
  });
});

describe('toAgyPermissionRules', () => {
  it('toAgyPermissionRules_siempre_envuelveCadaLineaEnCommand', () => {
    expect(toAgyPermissionRules({ allow: ['echo a > b.txt'], deny: ['hostname'] })).toEqual({ allow: ['command(echo a > b.txt)'], deny: ['command(hostname)'] });
  });

  it('toAgyPermissionRules_vacias_vacias', () => {
    expect(toAgyPermissionRules({ allow: [], deny: [] })).toEqual({ allow: [], deny: [] });
  });
});

describe('validateAgyLinkPath', () => {
  it.each([
    ['.aws', '.aws'],
    ['.config\\gcloud', '.config/gcloud'],
    ['./.kube/', '.kube'],
  ])('validateAgyLinkPath_relativa_%s_normaliza', (input, expected) => {
    expect(validateAgyLinkPath(input)).toEqual({ ok: true, path: expected });
  });

  it.each(['', 'C:\\Users\\u\\.aws', '/etc', '~/.aws', '../otro', '.gemini', '.gemini/antigravity-cli', '.gemini\\antigravity-cli\\brain'])(
    'validateAgyLinkPath_invalida_%s_laRechaza',
    (input) => {
      expect(validateAgyLinkPath(input).ok).toBe(false);
    },
  );
});

describe('agyLinkedPaths', () => {
  it('agyLinkedPaths_sinExtra_lasDeSerie', () => {
    expect(agyLinkedPaths([], true)).toEqual(['.gemini/config', '.ssh']);
  });

  it('agyLinkedPaths_conRepetidasEInvalidas_lasQuitaSinDistinguirMayusculasEnWindows', () => {
    expect(agyLinkedPaths(['.SSH', '.aws', '..', '.aws/'], true)).toEqual(['.gemini/config', '.ssh', '.aws']);
  });

  it('agyLinkedPaths_sensibleAMayusculas_conservaLasDistintas', () => {
    expect(agyLinkedPaths(['.SSH'], false)).toEqual(['.gemini/config', '.ssh', '.SSH']);
  });
});
