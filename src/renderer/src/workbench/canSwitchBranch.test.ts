import { describe, expect, it } from 'vitest';
import { canSwitchBranch } from './canSwitchBranch';

const CLEAN = { turnActive: false, dirty: false, detached: false };

describe('canSwitchBranch', () => {
  it('canSwitchBranch_limpioYSinTurno_permitido', () => {
    expect(canSwitchBranch(CLEAN)).toEqual({ allowed: true });
  });

  it('canSwitchBranch_conCambios_bloqueadoConMotivo', () => {
    expect(canSwitchBranch({ ...CLEAN, dirty: true })).toMatchObject({ allowed: false, reason: expect.stringContaining('sin confirmar') });
  });

  it('canSwitchBranch_turnoEnMarcha_bloqueadoAunqueEsteLimpio', () => {
    expect(canSwitchBranch({ ...CLEAN, turnActive: true })).toMatchObject({ allowed: false, reason: expect.stringContaining('turno') });
  });

  it('canSwitchBranch_headSuelta_bloqueado', () => {
    expect(canSwitchBranch({ ...CLEAN, detached: true })).toMatchObject({ allowed: false });
  });

  it('canSwitchBranch_turnoYCambios_mandaElTurno', () => {
    expect(canSwitchBranch({ turnActive: true, dirty: true, detached: true })).toMatchObject({ reason: expect.stringContaining('turno') });
  });
});

describe('canSwitchBranch (worktree, grupo D)', () => {
  it('canSwitchBranch_enUnWorktree_bloqueaAunqueEsteLimpio', () => {
    const verdict = canSwitchBranch({ turnActive: false, dirty: false, detached: false, worktree: true });

    expect(verdict).toEqual({ allowed: false, reason: expect.stringContaining('worktree') });
  });
});
