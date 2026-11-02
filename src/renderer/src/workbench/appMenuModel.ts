import { KEYBINDING_ACTIONS, type GuardContext, type KeybindingAction } from './keybindings/actionCatalog';
import { displayKeyCombo, parseKeyCombo } from './keybindings/keyParser';
import type { KeybindingOverride } from '@shared/settings';
import { t } from '../i18n/uiLanguage';

// Modelo PURO del menu de aplicacion (2.9.b). El menu se GENERA del catalogo de acciones, no se escribe
// a mano: si mañana una accion cambia de atajo o de etiqueta, el menu cambia con ella. Escribirlo a mano
// era garantizar que se quedara desfasado.
//
// Decision del usuario (§0.1): el menu propio SUSTITUYE al `Menu` nativo. Aqui solo se decide QUE hay en
// el menu; el coste de esa sustitucion (los aceleradores de edicion) se trata en `TitleBar`/`main`.

export interface AppMenuItem {
  readonly actionId: string | null; // null = separador o accion no rebindable (Editar/Ayuda)
  readonly label: string;
  readonly shortcut: string | null; // ya formateado para la plataforma
  // Un item cuyo guard no se cumple sale DESHABILITADO, no oculto: un menu que cambia de tamaño segun
  // el estado es peor que uno con items en gris.
  readonly enabled: boolean;
  // Comando de edicion nativo (`copy`, `paste`…) para los items del menu Editar, que no son acciones
  // del catalogo sino de `webContents`.
  readonly editCommand?: EditCommandName;
}

export interface AppMenu {
  readonly label: string;
  readonly items: readonly AppMenuItem[];
}

// Identificador interno de cada menu: no se ve; la etiqueta se traduce al construir el modelo.
type MenuId = 'conversation' | 'session' | 'edit';

export type EditCommandName = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

// De categoria del catalogo a menu. `Permiso` NO aparece: sus acciones son de un panel (permitir /
// denegar el permiso pendiente), no de la aplicacion, y en un menu serian cuatro items en gris el 99 %
// del tiempo. Las de scope `prompt` tampoco: no son acciones de menu (Enter, Tab…).
// La categoria llega ya traducida (la etiqueta del catalogo es un getter), asi que se compara con la del idioma activo.
function menuIdForCategory(category: string): MenuId | undefined {
  if (category === t('menu.category.app')) return 'conversation';
  if (category === t('menu.category.session')) return 'session';
  return undefined;
}

// Orden FIJO de los menus (no el de aparicion en el catalogo, que cambiaria al reordenarlo).
const MENU_ORDER: readonly MenuId[] = ['conversation', 'session', 'edit'];

function menuLabel(id: MenuId): string {
  if (id === 'conversation') return t('menu.appMenu.conversation');
  if (id === 'session') return t('menu.appMenu.session');
  return t('menu.appMenu.edit');
}

// El menu Editar: no sale del catalogo porque no son acciones de Mage sino de `webContents` (las
// mismas que daban los `role:` del menu nativo). Con el menu propio hay que reponerlas a mano.
type EditLabelKey = 'menu.appMenu.undo' | 'menu.appMenu.redo' | 'menu.appMenu.cut' | 'menu.appMenu.copy' | 'menu.appMenu.paste' | 'menu.appMenu.selectAll';
const EDIT_ITEMS: readonly { readonly label: EditLabelKey; readonly command: EditCommandName; readonly keys: string }[] = [
  { label: 'menu.appMenu.undo', command: 'undo', keys: 'CmdOrCtrl+Z' },
  { label: 'menu.appMenu.redo', command: 'redo', keys: 'CmdOrCtrl+Shift+Z' },
  { label: 'menu.appMenu.cut', command: 'cut', keys: 'CmdOrCtrl+X' },
  { label: 'menu.appMenu.copy', command: 'copy', keys: 'CmdOrCtrl+C' },
  { label: 'menu.appMenu.paste', command: 'paste', keys: 'CmdOrCtrl+V' },
  { label: 'menu.appMenu.selectAll', command: 'selectAll', keys: 'CmdOrCtrl+A' },
];

export interface AppMenuParams {
  readonly overrides: readonly KeybindingOverride[];
  readonly isMac: boolean;
  readonly guardContext: GuardContext;
  readonly catalog?: readonly KeybindingAction[]; // inyectable para tests
}

export function buildAppMenuModel(params: AppMenuParams): readonly AppMenu[] {
  const catalog = params.catalog ?? KEYBINDING_ACTIONS;
  const byMenu = new Map<MenuId, AppMenuItem[]>();

  for (const action of catalog) {
    if (action.scope !== 'global') continue; // las de `prompt` no son acciones de menu
    const menuId = menuIdForCategory(action.category);
    if (menuId === undefined) continue; // `Permiso` y cualquier categoria futura sin menu
    const items = byMenu.get(menuId) ?? [];
    items.push({
      actionId: action.id,
      label: action.label,
      shortcut: shortcutFor(action, params.overrides, params.isMac),
      enabled: action.guard === undefined || action.guard(params.guardContext),
    });
    byMenu.set(menuId, items);
  }

  byMenu.set(
    'edit',
    EDIT_ITEMS.map((item) => ({
      actionId: null,
      label: t(item.label),
      shortcut: formatKeys(item.keys, params.isMac),
      enabled: true,
      editCommand: item.command,
    })),
  );

  // Un menu sin items es un desplegable vacio: no se emite (invariante testeado).
  return MENU_ORDER.filter((id) => (byMenu.get(id)?.length ?? 0) > 0).map((id) => ({
    label: menuLabel(id),
    items: byMenu.get(id) ?? [],
  }));
}

// Atajo EFECTIVO de una accion: el override del usuario si es valido, si no el default del catalogo.
// Misma regla que el resolver (un override corrupto cae al default), para que el menu diga la verdad.
function shortcutFor(action: KeybindingAction, overrides: readonly KeybindingOverride[], isMac: boolean): string | null {
  const override = overrides.find((o) => o.actionId === action.id);
  const fromOverride = override === undefined ? null : formatKeys(override.keys, isMac);
  if (fromOverride !== null) return fromOverride;
  return action.defaultKeys === null ? null : formatKeys(action.defaultKeys, isMac);
}

function formatKeys(keys: string, isMac: boolean): string | null {
  const combo = parseKeyCombo(keys);
  return combo === null ? null : displayKeyCombo(combo, isMac);
}
