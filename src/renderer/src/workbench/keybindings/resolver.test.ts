import { describe, expect, it } from 'vitest';
import { resolveKeyEvent } from './resolver';
import { KEYBINDING_ACTIONS, type GuardContext, type KeybindingAction } from './actionCatalog';
import type { KeyEventLike } from './keyParser';

const NO_MODS: Omit<KeyEventLike, 'code'> = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
const NO_GUARD_CONTEXT: GuardContext = {
  promptTextEmpty: false,
  permissionPending: false,
  questionPending: false,
  turnRunning: false,
  dialogOrPopoverOpen: false,
  focusInEditableText: false,
};

function baseParams(overrides: Partial<Parameters<typeof resolveKeyEvent>[0]> = {}): Parameters<typeof resolveKeyEvent>[0] {
  return {
    event: { ...NO_MODS, code: 'KeyN', ctrlKey: true },
    activeScopes: ['global'],
    overrides: [],
    isMac: false,
    focusInEditableText: false,
    guardContext: NO_GUARD_CONTEXT,
    ...overrides,
  };
}

describe('resolveKeyEvent', () => {
  it('catalogoVacio_devuelveNull', () => {
    const result = resolveKeyEvent(baseParams({ catalog: [] }));
    expect(result).toBeNull();
  });

  it('teclaSinAccionEnNingunScope_devuelveNull', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'a.one', label: 'One', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+B', rebindable: true },
    ];
    const result = resolveKeyEvent(baseParams({ catalog, event: { ...NO_MODS, code: 'KeyZ' } }));
    expect(result).toBeNull();
  });

  it('coincideEnScopeGlobalConDefault_devuelveLaAccion', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'a.one', label: 'One', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+N', rebindable: true },
    ];
    const result = resolveKeyEvent(baseParams({ catalog }));
    expect(result).toBe('a.one');
  });

  it('overrideValido_pisaElDefault', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'a.one', label: 'One', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+N', rebindable: true },
    ];
    const result = resolveKeyEvent(
      baseParams({
        catalog,
        event: { ...NO_MODS, code: 'KeyB', ctrlKey: true },
        overrides: [{ actionId: 'a.one', keys: 'CmdOrCtrl+B' }],
      }),
    );
    expect(result).toBe('a.one');
    // El default (Ctrl+N) ya no dispara la accion tras el override.
    expect(resolveKeyEvent(baseParams({ catalog, overrides: [{ actionId: 'a.one', keys: 'CmdOrCtrl+B' }] }))).toBeNull();
  });

  it('overrideOrfano_seIgnoraSinRomperElRestoDeAcciones', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'a.one', label: 'One', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+N', rebindable: true },
    ];
    const result = resolveKeyEvent(
      baseParams({ catalog, overrides: [{ actionId: 'accion.inexistente', keys: 'CmdOrCtrl+Z' }] }),
    );
    expect(result).toBe('a.one');
  });

  it('overrideMalformado_caeAlDefaultEnVezDeDejarSinAtajo', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'a.one', label: 'One', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+N', rebindable: true },
    ];
    const result = resolveKeyEvent(
      baseParams({ catalog, overrides: [{ actionId: 'a.one', keys: 'Meta+++Raro' }] }),
    );
    expect(result).toBe('a.one');
  });

  it('accionSinDefaultNiOverride_nuncaDispara', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'session.compact', label: 'Compact', category: 'x', scope: 'global', defaultKeys: null, rebindable: true },
    ];
    const result = resolveKeyEvent(baseParams({ catalog, event: { ...NO_MODS, code: 'KeyC' } }));
    expect(result).toBeNull();
  });

  it('guardQueNuncaSeCumple_nuncaDisparaAunConTeclaCoincidente', () => {
    const catalog: readonly KeybindingAction[] = [
      {
        id: 'permission.allow',
        label: 'Allow',
        category: 'x',
        scope: 'global',
        defaultKeys: '1',
        rebindable: true,
        guard: () => false,
      },
    ];
    const result = resolveKeyEvent(baseParams({ catalog, event: { ...NO_MODS, code: 'Digit1' } }));
    expect(result).toBeNull();
  });

  it('guardQuePasa_disparaLaAccion', () => {
    const catalog: readonly KeybindingAction[] = [
      {
        id: 'permission.allow',
        label: 'Allow',
        category: 'x',
        scope: 'global',
        defaultKeys: '1',
        rebindable: true,
        guard: (ctx) => ctx.permissionPending,
      },
    ];
    const result = resolveKeyEvent(
      baseParams({ catalog, event: { ...NO_MODS, code: 'Digit1' }, guardContext: { ...NO_GUARD_CONTEXT, permissionPending: true } }),
    );
    expect(result).toBe('permission.allow');
  });

  it('resolver_permisoConPreguntaPendiente_devuelveNull', () => {
    // Catalogo REAL: con una pregunta pendiente, 1/2/3 no pueden contestarla como si fuera un permiso.
    const guardContext = { ...NO_GUARD_CONTEXT, permissionPending: true, questionPending: true };
    const results = ['Digit1', 'Digit2', 'Digit3'].map((code) =>
      resolveKeyEvent(baseParams({ catalog: KEYBINDING_ACTIONS, event: { ...NO_MODS, code }, guardContext })),
    );
    expect(results).toEqual([null, null, null]);
  });

  it('resolver_permisoSinPregunta_disparaPermitir', () => {
    const guardContext = { ...NO_GUARD_CONTEXT, permissionPending: true };
    expect(resolveKeyEvent(baseParams({ catalog: KEYBINDING_ACTIONS, event: { ...NO_MODS, code: 'Digit1' }, guardContext }))).toBe(
      'permission.allow',
    );
  });

  it('doAccionesMismoScopeMismaTecla_laGuardadaGanaSiSuGuardPasa', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'prompt.outdent', label: 'Outdent', category: 'x', scope: 'prompt', defaultKeys: 'Shift+Tab', rebindable: true },
      {
        id: 'prompt.cyclePermissionMode',
        label: 'Cycle',
        category: 'x',
        scope: 'prompt',
        defaultKeys: 'Shift+Tab',
        rebindable: true,
        guard: (ctx) => ctx.promptTextEmpty,
      },
    ];
    const event: KeyEventLike = { ...NO_MODS, code: 'Tab', shiftKey: true };
    const withEmptyInput = resolveKeyEvent(
      baseParams({ catalog, event, activeScopes: ['prompt'], guardContext: { ...NO_GUARD_CONTEXT, promptTextEmpty: true } }),
    );
    expect(withEmptyInput).toBe('prompt.cyclePermissionMode');
    const withText = resolveKeyEvent(
      baseParams({ catalog, event, activeScopes: ['prompt'], guardContext: { ...NO_GUARD_CONTEXT, promptTextEmpty: false } }),
    );
    expect(withText).toBe('prompt.outdent');
  });

  it('scopeMasEspecificoGanaSobreGlobal_siAmbosTienenAccionParaLaTecla', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'prompt.send', label: 'Send', category: 'x', scope: 'prompt', defaultKeys: 'Enter', rebindable: true },
      { id: 'global.enter', label: 'GlobalEnter', category: 'x', scope: 'global', defaultKeys: 'Enter', rebindable: true },
    ];
    const result = resolveKeyEvent(
      baseParams({ catalog, event: { ...NO_MODS, code: 'Enter' }, activeScopes: ['prompt', 'global'] }),
    );
    expect(result).toBe('prompt.send');
  });

  it('letraSueltaConFocoEnCampoDeTexto_seSuprime', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'permission.allow', label: 'Allow', category: 'x', scope: 'global', defaultKeys: '1', rebindable: true },
    ];
    const result = resolveKeyEvent(baseParams({ catalog, event: { ...NO_MODS, code: 'Digit1' }, focusInEditableText: true }));
    expect(result).toBeNull();
  });

  it('teclaConModificadorConFocoEnCampoDeTexto_noSeSuprime', () => {
    const catalog: readonly KeybindingAction[] = [
      { id: 'app.toggleSidebar', label: 'Sidebar', category: 'x', scope: 'global', defaultKeys: 'CmdOrCtrl+B', rebindable: true },
    ];
    const result = resolveKeyEvent(
      baseParams({ catalog, event: { ...NO_MODS, code: 'KeyB', ctrlKey: true }, focusInEditableText: true }),
    );
    expect(result).toBe('app.toggleSidebar');
  });

  // permission.cycleMode (feedback del usuario: Shift+Tab debe cambiar el modo de permiso con el foco
  // en cualquier parte de la app, no solo dentro del prompt) es scope 'global' con guard
  // `!focusInEditableText`, para no robarle Shift+Tab a la navegacion nativa de otros campos de texto
  // (ni duplicar el prompt.cyclePermissionMode local cuando el foco SI esta en el textarea del prompt).
  it('shiftTabScopeGlobal_sinFocoEnTexto_ciclaModoDePermiso', () => {
    const catalog: readonly KeybindingAction[] = [
      {
        id: 'permission.cycleMode',
        label: 'Cycle',
        category: 'x',
        scope: 'global',
        defaultKeys: 'Shift+Tab',
        rebindable: true,
        guard: (ctx) => !ctx.focusInEditableText,
      },
    ];
    const event: KeyEventLike = { ...NO_MODS, code: 'Tab', shiftKey: true };
    const result = resolveKeyEvent(
      baseParams({ catalog, event, focusInEditableText: false, guardContext: { ...NO_GUARD_CONTEXT, focusInEditableText: false } }),
    );
    expect(result).toBe('permission.cycleMode');
  });

  it('shiftTabScopeGlobal_conFocoEnCampoDeTexto_noDisparaNada', () => {
    const catalog: readonly KeybindingAction[] = [
      {
        id: 'permission.cycleMode',
        label: 'Cycle',
        category: 'x',
        scope: 'global',
        defaultKeys: 'Shift+Tab',
        rebindable: true,
        guard: (ctx) => !ctx.focusInEditableText,
      },
    ];
    const event: KeyEventLike = { ...NO_MODS, code: 'Tab', shiftKey: true };
    const result = resolveKeyEvent(
      baseParams({ catalog, event, focusInEditableText: true, guardContext: { ...NO_GUARD_CONTEXT, focusInEditableText: true } }),
    );
    expect(result).toBeNull();
  });
});
