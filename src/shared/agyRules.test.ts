import { describe, expect, it } from 'vitest';
import {
  agyLinkedPaths,
  agyMcpServerNames,
  isValidAgyRule,
  parseAgyMcpRule,
  setAgyCommandVerdict,
  toAgyPermissionRules,
  validateAgyCommand,
  validateAgyLinkPath,
  validateAgyMcpTool,
} from './agyRules';

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

describe('reglas MCP (fase 3)', () => {
  it('validateAgyMcpTool_servidorYHerramienta_devuelveLaReglaDeAgy', () => {
    expect(validateAgyMcpTool(' github ', ' create_issue ')).toEqual({ ok: true, rule: 'mcp(github/create_issue)' });
  });

  it('validateAgyMcpTool_comodin_valeParaTodasLasDelServidor', () => {
    expect(validateAgyMcpTool('github', '*')).toEqual({ ok: true, rule: 'mcp(github/*)' });
  });

  it.each([
    ['', 'tool'],
    ['srv', ''],
    ['*', 'tool'],
    ['a/b', 'tool'],
    ['srv', 'con espacio'],
    ['srv', 'x)'],
  ])('validateAgyMcpTool_invalido_%s_%s_loRechazaConMotivo', (server, tool) => {
    expect(validateAgyMcpTool(server, tool)).toMatchObject({ ok: false, message: expect.any(String) as unknown as string });
  });

  it('parseAgyMcpRule_reglaMcp_devuelveServidorYHerramienta', () => {
    expect(parseAgyMcpRule('mcp(magespike/mage_echo)')).toEqual({ server: 'magespike', tool: 'mage_echo' });
  });

  it.each(['git status', 'mcp(sin-barra)', 'mcp(a/b) extra', ''])('parseAgyMcpRule_noEsMcp_%#_null', (rule) => {
    expect(parseAgyMcpRule(rule)).toBeNull();
  });

  it('isValidAgyRule_comandoYMcp_validos_yRegexNo', () => {
    expect([isValidAgyRule('git status'), isValidAgyRule('mcp(s/t)'), isValidAgyRule('regex:.*')]).toEqual([true, true, false]);
  });

  it('setAgyCommandVerdict_reglaMcp_laGuardaTalCual', () => {
    expect(setAgyCommandVerdict({ allow: [], deny: ['mcp(s/t)'] }, 'mcp(s/t)', 'allow')).toEqual({ allow: ['mcp(s/t)'], deny: [] });
  });

  it('toAgyPermissionRules_mezcla_soloEnvuelveLosComandos', () => {
    expect(toAgyPermissionRules({ allow: ['git status', 'mcp(s/*)'], deny: ['mcp(s/t)'] })).toEqual({ allow: ['command(git status)', 'mcp(s/*)'], deny: ['mcp(s/t)'] });
  });

  it('agyMcpServerNames_soloLosQueCargaAgy_ordenadosYSinRepetir', () => {
    const rows = [
      { name: 'zeta', providers: ['agy'] },
      { name: 'solo-claude', providers: ['claude'] },
      { name: 'alfa', providers: ['claude', 'agy'] },
      { name: 'alfa', providers: ['agy'] },
      { name: 'con espacio', providers: ['agy'] },
    ];
    expect(agyMcpServerNames(rows)).toEqual(['alfa', 'zeta']);
  });

  it('agyMcpServerNames_vacio_vacio', () => {
    expect(agyMcpServerNames([])).toEqual([]);
  });
});
