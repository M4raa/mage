import { describe, expect, it } from 'vitest';
import { parseCommonSettings, serializeCommonSettings, type HookDraft, type PermissionDraft } from './sharedConfigModel';

// Los servidores MCP ya no se editan aqui como texto (P-028): su modelo vive en `@shared/mcp`.

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
