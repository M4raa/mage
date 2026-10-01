import { describe, expect, it } from 'vitest';
import { isKnownPermissionModeFor, parseClaudePermissionChoices, parseCodexPermissionProfiles, probePermissionModes } from './permissionModes';

// Salidas COPIADAS de los CLI el 2026-10-01 (`node spike/permission-modes-spike.mjs`).
const CLAUDE_2_1_286 =
  "error: option '--permission-mode <mode>' argument '__mage_probe__' is invalid. Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.";
const CODEX_0_144_4 = {
  data: [
    { id: ':read-only', description: null, allowed: true },
    { id: ':workspace', description: null, allowed: true },
    { id: ':danger-full-access', description: null, allowed: true },
  ],
  nextCursor: null,
};

describe('parseClaudePermissionChoices', () => {
  it('parseClaudePermissionChoices_salidaMedida_manualComoDefaultYSinDontAsk', () => {
    expect(parseClaudePermissionChoices(CLAUDE_2_1_286)).toEqual(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'plan']);
  });

  it('parseClaudePermissionChoices_modoNuevo_seRefleja', () => {
    expect(parseClaudePermissionChoices('Allowed choices are manual, plan, review.')).toEqual(['default', 'plan', 'review']);
  });

  it.each(['', 'error: unknown option', 'Allowed choices are .'])('parseClaudePermissionChoices_sinLista_null_%#', (output) => {
    expect(parseClaudePermissionChoices(output)).toBeNull();
  });
});

describe('parseCodexPermissionProfiles', () => {
  it('parseCodexPermissionProfiles_respuestaMedida_losTresPerfiles', () => {
    expect(parseCodexPermissionProfiles(CODEX_0_144_4)).toEqual([':read-only', ':workspace', ':danger-full-access']);
  });

  it('parseCodexPermissionProfiles_perfilNoPermitido_seOmite', () => {
    expect(parseCodexPermissionProfiles({ data: [{ id: ':a', allowed: false }, { id: ':b', allowed: true }] })).toEqual([':b']);
  });

  it.each([null, {}, { data: [] }, { data: [{ id: 3 }] }])('parseCodexPermissionProfiles_formaRara_null_%#', (result) => {
    expect(parseCodexPermissionProfiles(result)).toBeNull();
  });
});

describe('isKnownPermissionModeFor', () => {
  it('isKnownPermissionModeFor_claudeSinSondeo_laListaDeMage', () => {
    expect(isKnownPermissionModeFor('claude', 'plan', null)).toBe(true);
    expect(isKnownPermissionModeFor('claude', 'review', null)).toBe(false);
  });

  it('isKnownPermissionModeFor_claudeConModoNuevoSondeado_true', () => {
    expect(isKnownPermissionModeFor('claude', 'review', { claude: ['review'], codex: null })).toBe(true);
  });

  it('isKnownPermissionModeFor_codex_perfilesSondeadosOLaFormaSinSondeo', () => {
    expect(isKnownPermissionModeFor('codex', ':workspace', { claude: null, codex: [':workspace'] })).toBe(true);
    expect(isKnownPermissionModeFor('codex', ':otro', { claude: null, codex: [':workspace'] })).toBe(false);
    expect(isKnownPermissionModeFor('codex', ':workspace', null)).toBe(true);
    expect(isKnownPermissionModeFor('codex', 'plan', null)).toBe(false);
  });

  it('isKnownPermissionModeFor_otroProveedor_false', () => {
    expect(isKnownPermissionModeFor('agy', 'plan', null)).toBe(false);
  });
});

describe('probePermissionModes', () => {
  it('probePermissionModes_ambosContestan_ambasListas', async () => {
    const modes = await probePermissionModes({ runClaudeOracle: () => Promise.resolve(CLAUDE_2_1_286), readCodexProfiles: () => Promise.resolve(CODEX_0_144_4) });

    expect(modes.claude).toHaveLength(5);
    expect(modes.codex).toHaveLength(3);
  });

  it('probePermissionModes_ningunoContesta_null', async () => {
    expect(await probePermissionModes({ runClaudeOracle: () => Promise.resolve(null), readCodexProfiles: () => Promise.resolve(null) })).toEqual({ claude: null, codex: null });
  });
});
