import { describe, expect, it } from 'vitest';
import { codexPermissionPreset, parseCodexPermissionPreset } from './codexPermissions';

describe('codexPermissionPreset', () => {
  it('parseCodexPermissionPreset_perfilMedido_conservaAprobacionPorDefecto', () => {
    expect(parseCodexPermissionPreset(':workspace')).toEqual({ profile: ':workspace', approvalPolicy: 'on-request' });
  });

  it('parseCodexPermissionPreset_auto_decodificaPerfilYPolitica', () => {
    expect(parseCodexPermissionPreset(codexPermissionPreset(':workspace', 'never'))).toEqual({ profile: ':workspace', approvalPolicy: 'never' });
  });

  it('parseCodexPermissionPreset_politicaDesconocida_rechaza', () => {
    expect(parseCodexPermissionPreset(':workspace|untrusted')).toBeNull();
    expect(parseCodexPermissionPreset(':workspace|never|extra')).toBeNull();
  });
});
