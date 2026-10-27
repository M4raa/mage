// Idioma de la interfaz (F3, INFORME-033 §3 con U1 de DEVOLUCION-018). Funciones PURAS: main las usa con lo que dice
// el sistema y los tests con las combinaciones medidas en Electron real (Windows y WSL Ubuntu).
// El idioma de la interfaz NUNCA cambia lo que se envía al modelo ni la salida de los CLI.

export const UI_LANGUAGES = ['es', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

// Lo que guarda el usuario. «Sistema» sigue al sistema operativo.
export const UI_LANGUAGE_PREFERENCES = ['system', 'es', 'en'] as const;
export type UiLanguagePreference = (typeof UI_LANGUAGE_PREFERENCES)[number];

// U1: el respaldo cuando el sistema no está ni en castellano ni en inglés.
export const FALLBACK_UI_LANGUAGE: UiLanguage = 'en';

// Locale de formato por defecto de cada idioma, cuando el sistema no da una región del mismo idioma.
const DEFAULT_FORMAT_LOCALE: Readonly<Record<UiLanguage, string>> = { es: 'es-ES', en: 'en-US' };

export interface ResolvedUiLanguage {
  readonly language: UiLanguage;
  // El que daría «Sistema», para decirlo en el selector aunque el usuario haya elegido otro.
  readonly systemLanguage: UiLanguage;
  // Locale que se pasa SIEMPRE explícito a `Intl` (nunca el que tenga por defecto: en Linux con
  // `LANGUAGE=es:en` el `Intl` por defecto sigue en en-US, medido en INFORME-033).
  readonly formatLocale: string;
}

// Subtag primario de una etiqueta BCP 47 válida, o null si no lo es (Linux con `LANG=C.UTF-8` da `["c"]`).
function primarySubtagOf(tag: string): string | null {
  const match = /^([A-Za-z]{2,3})(?:[-_][A-Za-z0-9]{1,8})*$/.exec(tag.trim());
  return match === null ? null : match[1]!.toLowerCase();
}

function isUiLanguage(value: string | null): value is UiLanguage {
  return value !== null && (UI_LANGUAGES as readonly string[]).includes(value);
}

// Primera etiqueta del sistema (en el orden de `app.getPreferredSystemLanguages()`) que Mage sabe pintar.
function firstSupportedTag(tags: readonly string[]): { readonly tag: string; readonly language: UiLanguage } | null {
  for (const tag of tags) {
    const language = primarySubtagOf(tag);
    if (isUiLanguage(language)) return { tag, language };
  }
  return null;
}

export interface UiLanguageInput {
  readonly preference: UiLanguagePreference;
  readonly preferredSystemLanguages: readonly string[];
}

export function resolveUiLanguage(input: UiLanguageInput): UiLanguage {
  if (input.preference !== 'system') return input.preference;
  return firstSupportedTag(input.preferredSystemLanguages)?.language ?? FALLBACK_UI_LANGUAGE;
}

// Locale de formato del idioma resuelto: con la región del sistema si es del MISMO idioma (es-MX, en-GB); si no,
// la de por defecto del idioma.
export function resolveFormatLocale(language: UiLanguage, preferredSystemLanguages: readonly string[]): string {
  for (const tag of preferredSystemLanguages) {
    if (primarySubtagOf(tag) !== language) continue;
    const normalized = tag.trim().replace('_', '-');
    if (/^[A-Za-z]{2,3}-[A-Za-z]{2}$/.test(normalized)) return `${language}-${normalized.slice(-2).toUpperCase()}`;
  }
  return DEFAULT_FORMAT_LOCALE[language];
}

export function resolveUiLanguageWithFormat(input: UiLanguageInput): ResolvedUiLanguage {
  const language = resolveUiLanguage(input);
  const systemLanguage = resolveUiLanguage({ preference: 'system', preferredSystemLanguages: input.preferredSystemLanguages });
  return { language, systemLanguage, formatLocale: resolveFormatLocale(language, input.preferredSystemLanguages) };
}
