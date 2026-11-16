import { describe, expect, it } from 'vitest';
import {
  HIDDEN_VALUE,
  parseManagedFile,
  parsePolicyLimits,
  parseRemoteSettings,
  safeValueText,
} from './policyFiles';

const MEASURED = JSON.stringify({
  restrictions: {
    require_trusted_devices: { allowed: true },
    allow_remote_sessions: { allowed: false },
    allow_routines: { allowed: true },
    allow_remote_control: { allowed: false },
  },
  compliance_taints: [],
  monitoring_notice: null,
  defaults: { remote_control_at_startup: false },
});

describe('parsePolicyLimits', () => {
  it('parsePolicyLimits_formaMedida_restriccionesYDefaults', () => {
    const result = parsePolicyLimits(MEASURED);

    expect(result.state).toBe('ok');
    expect(result.restrictions.map((r) => r.name)).toEqual([
      'allow_remote_control',
      'allow_remote_sessions',
      'allow_routines',
      'require_trusted_devices',
    ]);
    expect(result.defaults).toEqual([{ name: 'remote_control_at_startup', value: 'false' }]);
    expect(result.monitoringNotice).toBeNull();
  });

  it('parsePolicyLimits_ausente_estadoAbsent', () => {
    expect(parsePolicyLimits(null).state).toBe('absent');
  });

  it('parsePolicyLimits_jsonRoto_estadoUnreadable', () => {
    expect(parsePolicyLimits('{ roto').state).toBe('unreadable');
  });

  it('parsePolicyLimits_noObjeto_estadoUnreadable', () => {
    expect(parsePolicyLimits('[]').state).toBe('unreadable');
  });

  it('parsePolicyLimits_claveDesconocida_vaAExtraSinValores', () => {
    const result = parsePolicyLimits(JSON.stringify({ vg: { token: 'secreto' } }));

    expect(result.extra).toEqual([{ name: 'vg', value: '{token}' }]);
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('parsePolicyLimits_restriccionSinAllowed_vaAExtra', () => {
    const result = parsePolicyLimits(JSON.stringify({ restrictions: { raro: { otro: 1 }, ok: { allowed: true } } }));

    expect(result.restrictions).toEqual([{ name: 'ok', allowed: true }]);
    expect(result.extra).toEqual([{ name: 'restrictions.raro', value: '{otro}' }]);
  });

  it('parsePolicyLimits_avisoDeSupervision_susClaves', () => {
    const result = parsePolicyLimits(JSON.stringify({ monitoring_notice: { text: 'hola', owner: 'x' } }));

    expect(result.monitoringNotice).toEqual([
      { name: 'owner', value: 'x' },
      { name: 'text', value: 'hola' },
    ]);
  });
});

describe('safeValueText', () => {
  it('safeValueText_claveSensible_oculta', () => {
    expect(safeValueText('apiToken', 'abc')).toBe(HIDDEN_VALUE);
  });

  it('safeValueText_textoLargo_recortado', () => {
    const result = safeValueText('nota', 'a'.repeat(81));

    expect(result).toBe(`${'a'.repeat(80)}…`);
  });

  it('safeValueText_objeto_soloClaves', () => {
    expect(safeValueText('env', { A: 'x', B: 'y' })).toBe('{A, B}');
  });
});

describe('parseRemoteSettings', () => {
  it('parseRemoteSettings_canales_unaEntrada', () => {
    const result = parseRemoteSettings('{"channelsEnabled":true}');

    expect(result).toEqual({ remoteState: 'ok', remote: [{ name: 'channelsEnabled', value: 'true' }] });
  });

  it('parseRemoteSettings_vacio_sinEntradas', () => {
    expect(parseRemoteSettings('{}')).toEqual({ remoteState: 'ok', remote: [] });
  });
});

describe('parseManagedFile', () => {
  it('parseManagedFile_env_soloNombres', () => {
    const result = parseManagedFile('managed-settings.json', JSON.stringify({ env: { K: 'v' } }));

    expect(result.entries).toEqual([{ name: 'env', value: '{K}' }]);
  });
});
