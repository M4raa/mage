// Contrato del mercado de temas (Open VSX). Mage importa TEMAS DE COLOR de VS Code desde open-vsx.org
// (registro abierto; el Marketplace de Microsoft prohibe su uso fuera de productos MS). Solo datos de
// tema (colores declarativos): nunca se ejecuta codigo de la extension.

// Resultado de una busqueda en Open VSX (subconjunto seguro para la UI).
export interface ThemeSearchItem {
  readonly namespace: string; // publisher
  readonly name: string; // nombre del paquete de la extension
  readonly version: string;
  readonly displayName: string; // titulo legible
  readonly description: string;
  readonly downloadCount: number;
  readonly iconUrl: string | null; // preview (puede faltar)
}

// Parametros para traer un tema concreto (identifican la version en Open VSX).
export interface FetchThemeParams {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}

// Regla de color de TOKEN de un tema de VS Code (`tokenColors`): asocia scopes TextMate a un estilo.
// Se transporta CASI tal cual (solo saneada a strings) porque shiki consume esta misma forma: es lo que
// permite resaltar el codigo del chat con los colores REALES del tema importado (F4).
export interface VscodeTokenColor {
  readonly scope?: string | readonly string[]; // ausente = regla global (fg/bg por defecto)
  readonly settings: {
    readonly foreground?: string;
    readonly background?: string;
    readonly fontStyle?: string; // 'italic' | 'bold' | 'underline' | combinaciones | ''
  };
}

// Tema de VS Code ya resuelto (manifest + fichero del tema), con los colores CRUDOS de VS Code. El
// mapeo a los tokens de Mage (--color-mg-*) se hace en el renderer (modulo puro vscodeTheme.ts).
export interface FetchedVscodeTheme {
  readonly label: string; // nombre de la contribucion de tema elegida
  readonly uiTheme: string; // 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  readonly type: string | null; // 'light' | 'dark' si el fichero del tema lo declara; si no, null
  readonly colors: Readonly<Record<string, string>>; // claves de VS Code -> color (#RRGGBB[AA])
  readonly tokenColors: readonly VscodeTokenColor[]; // reglas de resaltado; [] si el tema no las trae
}

// Marcador estable del error "esta extension no es un tema de color". Open VSX clasifica los ICON
// THEMES bajo `category=Themes` —medido el 2026-09-17: 4 de los 24 resultados mas descargados— y un
// icon theme no declara `contributes.themes`, asi que no se puede aplicar. El renderer necesita
// distinguir ese caso de un fallo de red para sacarlos de la rejilla en vez de dejarlos para siempre
// con "sin vista previa". Va aqui, y no como literal repetido, para que el mensaje y su deteccion no
// puedan divergir.
export const NOT_A_COLOR_THEME = 'NOT_A_COLOR_THEME';

export function isNotAColorThemeError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(NOT_A_COLOR_THEME);
}
