import { describe, expect, it } from 'vitest';
import { findConflict } from './conflicts';
import type { KeybindingAction } from './actionCatalog';

const CATALOG: readonly KeybindingAction[] = [
  { id: 'app.openSettings', label: 'Settings', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+,', rebindable: true },
  { id: 'app.toggleSidebar', label: 'Sidebar', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+B', rebindable: true },
  { id: 'prompt.send', label: 'Send', category: 'x', scope: 'prompt', defaultKeys: 'Enter', rebindable: true },
];

describe('findConflict', () => {
  it('sinChoqueConNinguno_devuelveNull', () => {
    const result = findConflict({ actionId: 'app.openSettings', keys: 'CmdOrCtrl+K', overrides: [], catalog: CATALOG });
    expect(result).toBeNull();
  });

  it('mismoScopeMismaCombinacionQueOtraAccion_devuelveConflicto', () => {
    const result = findConflict({ actionId: 'app.openSettings', keys: 'CmdOrCtrl+B', overrides: [], catalog: CATALOG });
    expect(result).toEqual({ actionId: 'app.toggleSidebar' });
  });

  it('otroScopeMismaCombinacion_noEsConflicto', () => {
    // prompt.send usa "Enter"; una accion global con "Enter" no deberia chocar (scopes distintos).
    const result = findConflict({ actionId: 'app.openSettings', keys: 'Enter', overrides: [], catalog: CATALOG });
    expect(result).toBeNull();
  });

  it('choqueContraUnOverrideVigenteDeOtraAccion_seDetecta', () => {
    // app.toggleSidebar ya tiene override a Ctrl+K; intentar poner openSettings tambien en Ctrl+K choca.
    const result = findConflict({
      actionId: 'app.openSettings',
      keys: 'CmdOrCtrl+K',
      overrides: [{ actionId: 'app.toggleSidebar', keys: 'CmdOrCtrl+K' }],
      catalog: CATALOG,
    });
    expect(result).toEqual({ actionId: 'app.toggleSidebar' });
  });

  it('accionInexistente_devuelveNullSinReventar', () => {
    const result = findConflict({ actionId: 'accion.fantasma', keys: 'CmdOrCtrl+B', overrides: [], catalog: CATALOG });
    expect(result).toBeNull();
  });

  it('combinacionCandidataMalformada_devuelveNull', () => {
    const result = findConflict({ actionId: 'app.openSettings', keys: 'Meta+++Raro', overrides: [], catalog: CATALOG });
    expect(result).toBeNull();
  });

  it('overrideOrfanoDeOtraAccion_seIgnoraAlCompararScope', () => {
    // Un override huerfano no debe reventar la comprobacion ni contar como ocupante del scope.
    const result = findConflict({
      actionId: 'app.openSettings',
      keys: 'CmdOrCtrl+B',
      overrides: [{ actionId: 'accion.inexistente', keys: 'CmdOrCtrl+B' }],
      catalog: CATALOG,
    });
    // Sigue chocando con app.toggleSidebar (su DEFAULT), el override huerfano es irrelevante.
    expect(result).toEqual({ actionId: 'app.toggleSidebar' });
  });
});
