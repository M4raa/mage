// Catalogo central de acciones REBINDABLES (D5, PLAN-D5-KEYBINDINGS.md §2/§3.1). Modulo PURO: registro
// estatico, sin DOM. Las teclas FIJAS (§2.1: Escape de dialogo/popover, focus trap, roving tablist,
// autocompletado "/", confirmar/cancelar edicion en linea) NO pasan por aqui — son contrato de
// accesibilidad y los componentes las siguen manejando directamente, intocables por el usuario.

import { PANEL_REGISTRY } from '../panels/panelRegistry';
import { t } from '../../i18n/uiLanguage';

// Zonas de la UI que puede tener el foco, apiladas de mas a menos especifica por el caller (resolver.ts
// itera esa pila buscando la primera con una accion para la tecla pulsada).
export type KeybindingScope = 'prompt' | 'global';

// Estado efimero que decide si una accion GUARDADA aplica ahora mismo (no es "donde esta el foco", que ya
// resuelve el scope, sino "en que estado esta la UI"). No es configurable por el usuario: es intrinseco al
// significado de la accion (§3.2).
export interface GuardContext {
  readonly promptTextEmpty: boolean; // input del prompt vacio (tras trim)
  readonly permissionPending: boolean; // hay un permiso pendiente en la pestana activa
  // La peticion pendiente es una PREGUNTA (AskUserQuestion): se contesta en su tarjeta, nunca con 1/2/3.
  readonly questionPending: boolean;
  readonly turnRunning: boolean; // la pestana activa tiene un turno en marcha (streaming o necesita permiso)
  readonly dialogOrPopoverOpen: boolean; // algun dialogo/popover de la app esta abierto
  // El foco esta en CUALQUIER campo de texto editable (no solo el prompt): usado por
  // permission.cycleMode para no robarle Shift+Tab a la navegacion nativa de otros inputs.
  readonly focusInEditableText: boolean;
}

// Los atajos de permiso solo aplican a un permiso de verdad: con una pregunta pendiente, `1` la
// contestaba vacia y `3` la denegaba sin que el usuario la hubiera leido (P-026, 1.4).
const canAnswerPermission = (ctx: GuardContext): boolean => ctx.permissionPending && !ctx.questionPending;

export interface KeybindingAction {
  readonly id: string; // "dominio.accion", estable (se persiste en los overrides)
  readonly label: string; // etiqueta para la UI de Configuracion
  readonly category: string; // agrupacion en la lista de Configuracion
  readonly scope: KeybindingScope;
  readonly defaultKeys: string | null; // combinacion por defecto en formato canonico; null = sin default
  readonly rebindable: boolean;
  // Predicado puro adicional: si esta presente, la accion solo se acepta cuando pasa. Ver resolver.ts.
  readonly guard?: (ctx: GuardContext) => boolean;
}

// Definicion de una accion tal como se escribe aqui: etiqueta y categoria como CLAVES del catalogo de textos.
type ActionLabelKey = 'menu.action.promptSend' | 'menu.action.promptIndent' | 'menu.action.promptOutdent' | 'menu.action.promptCyclePermissionMode' | 'menu.action.conversationNew' | 'menu.action.windowNew' | 'menu.action.tabClose' | 'menu.action.tabNext' | 'menu.action.tabPrevious' | 'menu.action.sessionInterrupt' | 'menu.action.sessionCompact' | 'menu.action.appOpenSettings' | 'menu.action.appToggleSidebar' | 'menu.action.appToggleInspector' | 'menu.action.permissionAllow' | 'menu.action.permissionAllowAlways' | 'menu.action.permissionDeny' | 'menu.action.permissionCycleMode';
type ActionCategoryKey = 'menu.category.prompt' | 'menu.category.app' | 'menu.category.session' | 'menu.category.permission' | 'menu.category.panels';
interface ActionDefinition extends Omit<KeybindingAction, 'label' | 'category'> {
  readonly labelKey: ActionLabelKey;
  readonly categoryKey: ActionCategoryKey;
}

// `label` y `category` son GETTERS: se traducen al LEERLOS, no al importar el modulo (el idioma aun no se conoce) y
// siguen siendo un `string` para quien las lee (Configuracion, el menu, la bienvenida).
function localizeAction(definition: ActionDefinition): KeybindingAction {
  const { labelKey, categoryKey, ...rest } = definition;
  return {
    ...rest,
    get label() {
      return t(labelKey);
    },
    get category() {
      return t(categoryKey);
    },
  };
}

const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  // --- Prompt (§2.2): ya cableadas hoy a mano, pasan a resolverse por catalogo. ---
  { id: 'prompt.send', labelKey: 'menu.action.promptSend', categoryKey: 'menu.category.prompt', scope: 'prompt', defaultKeys: 'Enter', rebindable: true },
  { id: 'prompt.indent', labelKey: 'menu.action.promptIndent', categoryKey: 'menu.category.prompt', scope: 'prompt', defaultKeys: 'Tab', rebindable: true },
  {
    id: 'prompt.outdent',
    labelKey: 'menu.action.promptOutdent',
    categoryKey: 'menu.category.prompt',
    scope: 'prompt',
    defaultKeys: 'Shift+Tab',
    rebindable: true,
  },
  {
    id: 'prompt.cyclePermissionMode',
    labelKey: 'menu.action.promptCyclePermissionMode',
    categoryKey: 'menu.category.prompt',
    scope: 'prompt',
    defaultKeys: 'Shift+Tab',
    rebindable: true,
    // Solo con el input vacio: si no, Shift+Tab desindenta (prompt.outdent). Mismo comportamiento que
    // hoy, ahora expresado como prioridad de guard en vez de un if anidado en el componente.
    guard: (ctx) => ctx.promptTextEmpty,
  },
  // prompt.continueList (Shift+Enter) NO entra en el catalogo a proposito (§2.2): es la convencion
  // universal de "salto de linea" de cualquier editor; permitir rebindarla confunde mas de lo que ahorra.

  // --- Aplicacion / sesion (§2.3): hoy solo con raton o inexistentes. ---
  { id: 'conversation.new', labelKey: 'menu.action.conversationNew', categoryKey: 'menu.category.app', scope: 'global', defaultKeys: 'CmdOrCtrl+N', rebindable: true },
  // Id NUEVO al final de su bloque: las preferencias de atajo se guardan POR id, asi que añadir no
  // rompe nada de lo ya persistido (lo que si rompe es renombrar o reordenar — ver la skill tocar-main).
  { id: 'window.new', labelKey: 'menu.action.windowNew', categoryKey: 'menu.category.app', scope: 'global', defaultKeys: 'CmdOrCtrl+Shift+N', rebindable: true },
  { id: 'tab.close', labelKey: 'menu.action.tabClose', categoryKey: 'menu.category.app', scope: 'global', defaultKeys: 'CmdOrCtrl+W', rebindable: true },
  { id: 'tab.next', labelKey: 'menu.action.tabNext', categoryKey: 'menu.category.app', scope: 'global', defaultKeys: 'CmdOrCtrl+Tab', rebindable: true },
  {
    id: 'tab.previous',
    labelKey: 'menu.action.tabPrevious',
    categoryKey: 'menu.category.app',
    scope: 'global',
    defaultKeys: 'CmdOrCtrl+Shift+Tab',
    rebindable: true,
  },
  {
    id: 'session.interrupt',
    labelKey: 'menu.action.sessionInterrupt',
    categoryKey: 'menu.category.session',
    scope: 'global',
    defaultKeys: 'Escape',
    rebindable: true,
    // Solo si hay un turno corriendo y no hay dialogo/popover abierto (ese caso lo cierra el
    // contrato fijo de §2.1, no esta accion). Sin turno corriendo, Escape no hace nada (igual que hoy).
    guard: (ctx) => ctx.turnRunning && !ctx.dialogOrPopoverOpen,
  },
  {
    id: 'session.compact',
    labelKey: 'menu.action.sessionCompact',
    categoryKey: 'menu.category.session',
    scope: 'global',
    defaultKeys: null, // sin tecla por defecto a proposito: no es una accion para gatillo facil
    rebindable: true,
  },
  { id: 'app.openSettings', labelKey: 'menu.action.appOpenSettings', categoryKey: 'menu.category.app', scope: 'global', defaultKeys: 'CmdOrCtrl+,', rebindable: true },
  {
    id: 'app.toggleSidebar',
    labelKey: 'menu.action.appToggleSidebar',
    categoryKey: 'menu.category.app',
    scope: 'global',
    defaultKeys: 'CmdOrCtrl+B',
    rebindable: true,
  },
  {
    id: 'app.toggleInspector',
    labelKey: 'menu.action.appToggleInspector',
    categoryKey: 'menu.category.app',
    scope: 'global',
    defaultKeys: 'CmdOrCtrl+I',
    rebindable: true,
  },
  {
    id: 'permission.allow',
    labelKey: 'menu.action.permissionAllow',
    categoryKey: 'menu.category.permission',
    scope: 'global',
    defaultKeys: '1',
    rebindable: true,
    guard: canAnswerPermission,
  },
  {
    id: 'permission.allowAlways',
    labelKey: 'menu.action.permissionAllowAlways',
    categoryKey: 'menu.category.permission',
    scope: 'global',
    defaultKeys: '2',
    rebindable: true,
    guard: canAnswerPermission,
  },
  {
    id: 'permission.deny',
    labelKey: 'menu.action.permissionDeny',
    categoryKey: 'menu.category.permission',
    scope: 'global',
    defaultKeys: '3',
    rebindable: true,
    guard: canAnswerPermission,
  },
  {
    id: 'permission.cycleMode',
    labelKey: 'menu.action.permissionCycleMode',
    categoryKey: 'menu.category.permission',
    scope: 'global',
    defaultKeys: 'Shift+Tab',
    rebindable: true,
    // Version GLOBAL de prompt.cyclePermissionMode (feedback del usuario: Shift+Tab debe cambiar el
    // modo de permiso con el foco en cualquier parte de la app, no solo dentro del prompt). Se apaga
    // con el foco en CUALQUIER campo de texto editable para no romper el Shift+Tab nativo de otros
    // inputs (buscador del sidebar, dialogos...); dentro del propio prompt sigue mandando el par local
    // prompt.outdent/prompt.cyclePermissionMode (scope 'prompt'), sin cambios.
    guard: (ctx) => !ctx.focusInEditableText,
  },
  // --- Paneles (F6/I10b): 'conversations'/'permissions' ya tienen su atajo con nombre propio arriba
  // (app.toggleSidebar/app.toggleInspector, con menu y CmdOrCtrl+B/I); el resto del registro de F6 se
  // queda sin ninguno. Generado desde PANEL_REGISTRY (no una lista escrita a mano) para que un panel
  // nuevo aparezca aqui solo, sin otra copia de sus ids que mantener sincronizada.
];

const PANEL_TOGGLE_ACTIONS: readonly KeybindingAction[] = PANEL_REGISTRY.filter((p) => p.id !== 'conversations' && p.id !== 'permissions').map(
  (p): KeybindingAction => ({
    id: `panel.toggle.${p.id}`,
    scope: 'global',
    defaultKeys: null, // sin default: 8 atajos nuevos de golpe pisarian teclas del SO/navegador
    rebindable: true,
    get label() {
      return t('menu.action.togglePanel', { title: p.title });
    },
    get category() {
      return t('menu.category.panels');
    },
  }),
);

export const KEYBINDING_ACTIONS: readonly KeybindingAction[] = [...ACTION_DEFINITIONS.map(localizeAction), ...PANEL_TOGGLE_ACTIONS];
