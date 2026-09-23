import { describe, expect, it } from 'vitest';
import {
  parseCommonSettings,
  parseEnvText,
  parseMcpServers,
  serializeCommonSettings,
  serializeMcpServers,
  type HookDraft,
  type McpServerDraft,
  type PermissionDraft,
} from './sharedConfigModel';

function server(overrides: Partial<McpServerDraft> = {}): McpServerDraft {
  return { name: 'db', command: 'node', argsText: '', envText: '', rest: {}, ...overrides };
}

describe('parseMcpServers', () => {
  it('parseMcpServers_ficheroVacio_sinServidoresNiError', () => {
    const result = parseMcpServers('{"mcpServers": {}}');

    expect(result).toEqual({ servers: [], error: null });
  });

  it('parseMcpServers_sinClaveMcpServers_sinServidoresNiError', () => {
    expect(parseMcpServers('{}')).toEqual({ servers: [], error: null });
  });

  it('parseMcpServers_jsonInvalido_devuelveError', () => {
    const result = parseMcpServers('{no json');

    expect(result.servers).toEqual([]);
    expect(result.error).toContain('JSON inválido');
  });

  it('parseMcpServers_mcpServersNoEsObjeto_devuelveError', () => {
    expect(parseMcpServers('{"mcpServers": []}').error).toContain('no es un objeto');
  });

  it('parseMcpServers_servidorCompleto_aplanaArgsYEnv', () => {
    const raw = '{"mcpServers":{"db":{"command":"node","args":["a.js","--port=1"],"env":{"TOKEN":"x"},"cwd":"/tmp"}}}';

    const result = parseMcpServers(raw);

    expect(result.servers).toEqual([
      { name: 'db', command: 'node', argsText: 'a.js\n--port=1', envText: 'TOKEN=x', rest: { cwd: '/tmp' } },
    ]);
  });

  it('parseMcpServers_servidorNoObjeto_devuelveBorradorVacioSinRomper', () => {
    const result = parseMcpServers('{"mcpServers":{"roto":42}}');

    expect(result.servers).toEqual([{ name: 'roto', command: '', argsText: '', envText: '', rest: {} }]);
  });
});

describe('serializeMcpServers', () => {
  it('serializeMcpServers_servidorNuevo_escribeComandoArgsYEnv', () => {
    const text = serializeMcpServers('{"mcpServers":{}}', [server({ argsText: 'a.js\n\nb.js', envText: 'K=v=1' })]);

    expect(JSON.parse(text)).toEqual({
      mcpServers: { db: { command: 'node', args: ['a.js', 'b.js'], env: { K: 'v=1' } } },
    });
  });

  it('serializeMcpServers_conCamposNoEditables_losPreserva', () => {
    const text = serializeMcpServers('{"mcpServers":{}}', [server({ rest: { type: 'stdio' } })]);

    expect(JSON.parse(text).mcpServers.db).toEqual({ type: 'stdio', command: 'node' });
  });

  it('serializeMcpServers_conOtrasClavesDeNivelSuperior_lasPreserva', () => {
    const text = serializeMcpServers('{"mcpServers":{},"otra":1}', []);

    expect(JSON.parse(text)).toEqual({ otra: 1, mcpServers: {} });
  });

  it('serializeMcpServers_listaVacia_dejaMcpServersVacio', () => {
    expect(JSON.parse(serializeMcpServers('{"mcpServers":{"db":{}}}', []))).toEqual({ mcpServers: {} });
  });

  it('serializeMcpServers_baseNoEsJson_lanzaConElMotivo', () => {
    expect(() => serializeMcpServers('{roto', [])).toThrow(/mcp-common\.json/);
  });

  it('serializeMcpServers_envMalFormado_lanzaNombrandoElServidor', () => {
    expect(() => serializeMcpServers('{}', [server({ envText: 'sin-igual' })])).toThrow(/"db"/);
  });
});

describe('parseEnvText', () => {
  it('parseEnvText_vacio_sinVariablesNiError', () => {
    expect(parseEnvText('')).toEqual({ value: {}, error: null });
  });

  it('parseEnvText_valorConIgual_parteSoloEnElPrimero', () => {
    expect(parseEnvText('URL=http://a?b=c').value).toEqual({ URL: 'http://a?b=c' });
  });

  it('parseEnvText_lineaSinIgual_devuelveError', () => {
    expect(parseEnvText('KEY').error).toContain('CLAVE=valor');
  });

  it('parseEnvText_lineaQueEmpiezaPorIgual_devuelveError', () => {
    expect(parseEnvText('=v').error).not.toBeNull();
  });
});

describe('parseCommonSettings', () => {
  it('parseCommonSettings_vacio_sinHooksNiPermisos', () => {
    expect(parseCommonSettings('{}')).toEqual({ hooks: [], permissions: [], error: null });
  });

  it('parseCommonSettings_jsonInvalido_devuelveError', () => {
    expect(parseCommonSettings('nope').error).toContain('JSON inválido');
  });

  it('parseCommonSettings_hooksAnidados_seAplananAUnaFilaPorComando', () => {
    const raw = '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"a"},{"command":"b"}]}]}}';

    expect(parseCommonSettings(raw).hooks).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', command: 'a' },
      { event: 'PreToolUse', matcher: 'Bash', command: 'b' },
    ]);
  });

  it('parseCommonSettings_hookSinMatcher_dejaMatcherNulo', () => {
    const raw = '{"hooks":{"Stop":[{"hooks":[{"command":"a"}]}]}}';

    expect(parseCommonSettings(raw).hooks).toEqual([{ event: 'Stop', matcher: null, command: 'a' }]);
  });

  it('parseCommonSettings_permisos_denyAntesQueAllow', () => {
    const raw = '{"permissions":{"allow":["Read(*)"],"deny":["Bash(rm*)"]}}';

    expect(parseCommonSettings(raw).permissions).toEqual([
      { effect: 'deny', pattern: 'Bash(rm*)' },
      { effect: 'allow', pattern: 'Read(*)' },
    ]);
  });

  it('parseCommonSettings_formasInesperadas_seIgnoranSinRomper', () => {
    const raw = '{"hooks":{"Stop":"no-array"},"permissions":{"allow":[1,"ok"]}}';

    const result = parseCommonSettings(raw);

    expect(result.hooks).toEqual([]);
    expect(result.permissions).toEqual([{ effect: 'allow', pattern: 'ok' }]);
  });
});

describe('serializeCommonSettings', () => {
  const hook: HookDraft = { event: 'PreToolUse', matcher: 'Bash', command: 'echo 1' };
  const rule: PermissionDraft = { effect: 'deny', pattern: 'Bash(rm*)' };

  it('serializeCommonSettings_hookYRegla_escribeLaFormaDelCli', () => {
    const text = serializeCommonSettings('{}', [hook], [rule]);

    expect(JSON.parse(text)).toEqual({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo 1' }] }] },
      permissions: { deny: ['Bash(rm*)'] },
    });
  });

  it('serializeCommonSettings_dosHooksMismoEventoYMatcher_compartenGrupo', () => {
    const text = serializeCommonSettings('{}', [hook, { ...hook, command: 'echo 2' }], []);

    expect(JSON.parse(text).hooks.PreToolUse).toHaveLength(1);
    expect(JSON.parse(text).hooks.PreToolUse[0].hooks).toHaveLength(2);
  });

  it('serializeCommonSettings_mismoEventoDistintoMatcher_creaDosGrupos', () => {
    const text = serializeCommonSettings('{}', [hook, { ...hook, matcher: null }], []);

    expect(JSON.parse(text).hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo 1' }] },
      { hooks: [{ type: 'command', command: 'echo 1' }] },
    ]);
  });

  it('serializeCommonSettings_sinNada_borraLasDosClaves', () => {
    expect(JSON.parse(serializeCommonSettings('{"hooks":{},"permissions":{"allow":["x"]}}', [], []))).toEqual({});
  });

  it('serializeCommonSettings_comandoVacio_seDescarta', () => {
    expect(JSON.parse(serializeCommonSettings('{}', [{ ...hook, command: '  ' }], []))).toEqual({});
  });

  it('serializeCommonSettings_otrasClaves_sePreservan', () => {
    expect(JSON.parse(serializeCommonSettings('{"model":"x"}', [], [rule])).model).toBe('x');
  });

  it('serializeCommonSettings_baseNoEsJson_lanzaConElMotivo', () => {
    expect(() => serializeCommonSettings('[]', [], [])).toThrow(/settings-common\.json/);
  });
});
