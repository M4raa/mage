import { describe, expect, it } from 'vitest';
import { buildAppMenuModel } from './appMenuModel';
import type { GuardContext, KeybindingAction } from './keybindings/actionCatalog';

const CTX: GuardContext = {
  promptTextEmpty: true,
  permissionPending: false,
  turnRunning: false,
  dialogOrPopoverOpen: false,
  focusInEditableText: false,
};

const params = (over: Partial<Parameters<typeof buildAppMenuModel>[0]> = {}) => ({
  overrides: [],
  isMac: false,
  guardContext: CTX,
  ...over,
});

const labelsOf = (menus: ReturnType<typeof buildAppMenuModel>, menu: string): readonly string[] =>
  menus.find((m) => m.label === menu)?.items.map((i) => i.label) ?? [];

describe('buildAppMenuModel', () => {
  it('buildAppMenuModel_soloIncluyeAccionesGlobales', () => {
    // Las de scope `prompt` (Enter, Tab, Shift+Tab…) no son acciones de menu.
    const all = buildAppMenuModel(params()).flatMap((menu) => menu.items.map((item) => item.actionId));

    expect(all).toContain('conversation.new');
    expect(all).not.toContain('prompt.send');
    expect(all).not.toContain('prompt.indent');
  });

  it('buildAppMenuModel_categoriaPermiso_noGeneraMenu', () => {
    // Sus acciones son de un panel, no de la app: en un menu serian items en gris casi siempre.
    const menus = buildAppMenuModel(params());

    expect(menus.map((m) => m.label)).not.toContain('Permiso');
    expect(menus.flatMap((m) => m.items.map((i) => i.actionId))).not.toContain('permission.allow');
  });

  it('buildAppMenuModel_accionSinAtajo_shortcutEsNull', () => {
    // `session.compact` tiene `defaultKeys: null` a proposito.
    const item = buildAppMenuModel(params())
      .flatMap((menu) => menu.items)
      .find((i) => i.actionId === 'session.compact');

    expect(item?.shortcut).toBeNull();
  });

  it('buildAppMenuModel_conOverrideDelUsuario_pintaElAtajoNuevo', () => {
    const menus = buildAppMenuModel(params({ overrides: [{ actionId: 'conversation.new', keys: 'CmdOrCtrl+Shift+K' }] }));

    const item = menus.flatMap((m) => m.items).find((i) => i.actionId === 'conversation.new');
    expect(item?.shortcut).toBe('Ctrl+Shift+K');
  });

  it('buildAppMenuModel_overrideCorrupto_caeAlAtajoPorDefecto', () => {
    // Misma regla que el resolver: un override invalido no deja la accion sin atajo NI miente en el menu.
    const menus = buildAppMenuModel(params({ overrides: [{ actionId: 'conversation.new', keys: '???' }] }));

    expect(menus.flatMap((m) => m.items).find((i) => i.actionId === 'conversation.new')?.shortcut).toBe('Ctrl+N');
  });

  it('buildAppMenuModel_guardQueNoSeCumple_itemDeshabilitado', () => {
    // `session.interrupt` solo aplica con un turno corriendo: en gris, NO oculto.
    const parado = buildAppMenuModel(params()).flatMap((m) => m.items).find((i) => i.actionId === 'session.interrupt');
    const corriendo = buildAppMenuModel(params({ guardContext: { ...CTX, turnRunning: true } }))
      .flatMap((m) => m.items)
      .find((i) => i.actionId === 'session.interrupt');

    expect(parado?.enabled).toBe(false);
    expect(corriendo?.enabled).toBe(true);
  });

  it('buildAppMenuModel_enMac_usaLosSimbolosDeMac', () => {
    const item = buildAppMenuModel(params({ isMac: true }))
      .flatMap((m) => m.items)
      .find((i) => i.actionId === 'conversation.new');

    expect(item?.shortcut).toBe('⌘+N');
  });

  it('buildAppMenuModel_catalogoVacio_devuelveSoloEditar', () => {
    // Sin acciones no hay menus de Mage, pero Editar sigue: sus items no salen del catalogo.
    const menus = buildAppMenuModel(params({ catalog: [] as readonly KeybindingAction[] }));

    expect(menus.map((m) => m.label)).toEqual(['Editar']);
  });

  it('buildAppMenuModel_ningunMenuQuedaVacio', () => {
    // Un desplegable vacio es un bug visible.
    expect(buildAppMenuModel(params()).every((menu) => menu.items.length > 0)).toBe(true);
  });

  it('buildAppMenuModel_menuEditar_traeLosSeisComandosNativos', () => {
    // Con el menu nativo fuera, estos son los aceleradores que hay que reponer a mano.
    expect(labelsOf(buildAppMenuModel(params()), 'Editar')).toEqual([
      'Deshacer',
      'Rehacer',
      'Cortar',
      'Copiar',
      'Pegar',
      'Seleccionar todo',
    ]);
    const copiar = buildAppMenuModel(params())
      .flatMap((m) => m.items)
      .find((i) => i.label === 'Copiar');
    expect(copiar?.editCommand).toBe('copy');
    expect(copiar?.actionId).toBeNull();
  });

  it('buildAppMenuModel_ordenDeMenus_esFijo', () => {
    // No el del catalogo: reordenarlo no puede reordenar la barra de menus.
    expect(buildAppMenuModel(params()).map((m) => m.label)).toEqual(['Conversación', 'Sesión', 'Editar']);
  });
});
