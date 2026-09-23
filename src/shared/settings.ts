// Configuracion de la app (M2.3) persistida en userData/app-settings.json. Separada del workspace
// (workspace = sesiones/pestanas; settings = preferencias globales de la app). Crece por secciones;
// la primera son las reglas de notificacion por regex.

import type { CustomProvider } from './providers';
import type { VscodeTokenColor } from './themeMarket';

// Regla de notificacion: si el texto del asistente al terminar un turno casa con `pattern` (RegExp)
// y la regla esta activa, se dispara una notificacion del SO. El patron se guarda como string y se
// compila en la frontera con try/catch (un patron invalido nunca rompe el flujo).
export interface NotificationRule {
  readonly id: string;
  readonly label: string;
  readonly pattern: string;
  readonly enabled: boolean;
}

export const APP_SETTINGS_VERSION = 1;

// Preferencia de tema (M3): 'system' sigue al SO (prefers-color-scheme), 'light'/'dark' lo fuerzan.
// El tema RESUELTO (siempre 'light'|'dark') se calcula en el renderer con resolveTheme(pref, prefersDark).
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

// Tema de color importado desde Open VSX (VS Code). Se guarda YA MAPEADO a los tokens de Mage
// (--color-mg-* -> color), asi aplicarlo en runtime es solo inyectar variables. `type` decide el tema
// base (data-theme) para los tokens no mapeados.
export interface ImportedTheme {
  readonly id: string; // estable, p.ej. "ovsx:<namespace>.<name>"
  readonly label: string; // nombre visible del tema
  readonly type: 'light' | 'dark'; // base para los tokens no mapeados
  readonly tokens: Readonly<Record<string, string>>; // overrides de --color-mg-* ya mapeados
  // Reglas `tokenColors` del tema de VS Code, guardadas TAL CUAL para alimentar al resaltador de
  // sintaxis del chat (F4): shiki consume esta misma forma. OPCIONAL a proposito — un app-settings.json
  // escrito antes de F4 no las tiene y debe seguir cargando (los bloques de codigo caen al tema base).
  readonly tokenColors?: readonly VscodeTokenColor[];
}

// Cuanto se conservan las carpetas de trabajo de las conversaciones "sin friccion" (el scratchpad de
// `<temp>/mage-scratch/<uuid>`). MEDIDO en el fuente del CLI: Claude Code NO barre su temp nunca — su
// `cleanupPeriodDays` (30 por defecto) purga cosas de `~/.claude`, incluidas las TRANSCRIPCIONES, pero
// no el directorio de trabajo. Son dos limpiezas disjuntas: a los 30 dias el CLI se lleva el `.jsonl`
// de la conversacion aunque Mage conserve su carpeta.
//   'never'   — no se borra nada (DEFAULT: Mage no toca ficheros del disco del usuario sin permiso).
//   'session' — incognito: se vacia al cerrar Mage y al arrancar. Reabrir esa conversacion la deja sin cwd.
//   '7d'/'30d'— por antiguedad de la carpeta; '30d' es el plazo que usa el CLI para lo suyo.
export const SCRATCH_RETENTIONS = ['never', 'session', '7d', '30d'] as const;
export type ScratchRetention = (typeof SCRATCH_RETENTIONS)[number];

export interface AppSettings {
  readonly version: number;
  readonly notificationRules: readonly NotificationRule[];
  // Preferencia de tema base (claro/oscuro/sistema). Default 'dark' para preservar el aspecto actual.
  readonly theme: ThemePreference;
  // Widget flotante always-on-top (M3): si esta activo, se abre al arrancar. Default false (opt-in).
  readonly widgetEnabled: boolean;
  // Opacidad de los FONDOS de la app, 50..100 (%). 100 = opaco, como siempre. Por debajo, las
  // superficies (ventana, rail, paneles, bloques) se pintan con alfa para dejar ver lo que hay detras
  // — en Windows 11, el material acrilico que activa el proceso main. El suelo es 50 A PROPOSITO:
  // por debajo el texto deja de leerse sobre un escritorio cualquiera, y un ajuste que permite
  // romper la app no es un ajuste. Default 100 (nadie estrena Mage translucida sin pedirlo).
  readonly backgroundOpacity: number;
  // Temas de color importados desde Open VSX (M3). Default [].
  readonly importedThemes: readonly ImportedTheme[];
  // Id del tema importado activo, o null para usar el tema base (`theme`). Default null.
  readonly activeThemeId: string | null;
  // Modelo por defecto POR PROVEEDOR (F3): id de proveedor -> id de modelo. Una conversacion nueva de
  // ese proveedor arranca con ese modelo. Un proveedor ausente del mapa = sin preferencia (se resuelve
  // por el ultimo usado o el fallback del proveedor; ver modelDefaults.ts). Default {}.
  readonly defaultModelByProvider: Readonly<Record<string, string>>;
  // Overrides de atajos de teclado (D5): solo lo que el usuario CAMBIO respecto al catalogo por
  // defecto (actionCatalog.ts) — nunca una copia completa, asi los defaults nuevos de futuras versiones
  // llegan solos. Una entrada con actionId que ya no existe en el catalogo se conserva en el fichero
  // (no se pierde el ajuste del usuario) pero se ignora al resolver; la UI de Configuracion la lista
  // como "ya no aplica". Default [].
  readonly keybindingOverrides: readonly KeybindingOverride[];
  // Proveedores compatibles con la API de OpenAI anadidos por el usuario (E2): runtimes locales
  // (Ollama, LM Studio) o cualquier endpoint remoto. Cada uno trae su URL base, sus modelos y una api
  // key opcional; el gateway los resuelve por id sin codigo especifico. Default [].
  readonly customProviders: readonly CustomProvider[];
  // Carpetas en las que el usuario ha AUTORIZADO lanzar un agente. Lanzar el CLI en una carpeta ejecuta
  // lo que esa carpeta traiga —sus hooks, su `.claude/settings.json`, sus servidores MCP—, asi que
  // abrir un repo ajeno es ejecutar codigo ajeno. En modo headless (que es como Mage lanza SIEMPRE) el
  // CLI NO pregunta: su dialogo de confianza es solo de la TUI interactiva, medido en el codigo del
  // propio CLI. Por eso la pregunta la tiene que hacer Mage.
  //
  // Se guardan NORMALIZADAS (ver `trustKey` en main/os/workspaceTrust.ts) y la comprobacion sube por
  // los padres, igual que hace el CLI: confiar en `C:/sourcecode` cubre todo lo que hay debajo.
  // Default []: no se estrena confiando en nada.
  readonly trustedFolders: readonly string[];
  // Retencion de los scratchpads (auditoria B.4.2). Default 'never': borrar ficheros del disco es una
  // decision del usuario, no un defecto.
  readonly scratchRetention: ScratchRetention;
  // Asistente de primer arranque: version del asistente que el usuario ya COMPLETO. 0 = nunca lo vio,
  // que es el default y lo que hace que salga en la primera apertura. Es un NUMERO y no un booleano a
  // proposito: el dia que el asistente gane un paso que haya que enseñar a quien ya lo hizo, basta
  // subir ONBOARDING_VERSION y vuelve a salir una sola vez.
  readonly onboardingCompletedVersion: number;
  // Escala de la interfaz en % (80..150). Se aplica con el zoom del propio Chromium (`webFrame`), asi
  // que escala TODO —texto, iconos, separaciones— sin que ningun componente tenga que saberlo.
  // Default 100. El suelo y el techo estan medidos por legibilidad: por debajo de 80 el texto de 10 px
  // del chat deja de leerse, y por encima de 150 el dialogo de Configuracion ya no cabe en 800 px.
  readonly uiScale: number;
  // Proveedor con el que se abre "Nueva conversacion" (lo elige el asistente, y se puede cambiar en
  // Configuracion). Default 'claude', que es lo que estaba escrito a mano en el dialogo.
  readonly defaultProvider: string;
}

// Version del asistente de primer arranque. Subirla hace que vuelva a salir UNA vez a quien ya lo
// completo con una version anterior.
export const ONBOARDING_VERSION = 1;

// Limites de `uiScale`, exportados porque los usan el asistente, Configuracion y el store (un rango
// escrito tres veces se desincroniza a la tercera).
export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_STEP = 10;

// Acota una escala a lo que la UI soporta. Cualquier entrada (un ajuste editado a mano, un valor de
// una version futura) sale dentro de rango y redondeada al entero.
export function clampUiScale(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(percent)));
}

// Override de un atajo (D5): que accion (id estable del catalogo) usa que combinacion (formato
// canonico, p.ej. "CmdOrCtrl+Shift+K"). Ver actionCatalog.ts/keyParser.ts en el renderer.
export interface KeybindingOverride {
  readonly actionId: string;
  readonly keys: string;
}

// Defaults de arranque limpio (sin fichero o corrupto): sin reglas, tema oscuro, widget apagado, sin
// temas importados y sin modelos por defecto fijados.
export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: APP_SETTINGS_VERSION,
  notificationRules: [],
  theme: 'dark',
  widgetEnabled: false,
  backgroundOpacity: 100,
  importedThemes: [],
  activeThemeId: null,
  defaultModelByProvider: {},
  keybindingOverrides: [],
  customProviders: [],
  trustedFolders: [],
  scratchRetention: 'never',
  onboardingCompletedVersion: 0,
  uiScale: 100,
  defaultProvider: 'claude',
};
