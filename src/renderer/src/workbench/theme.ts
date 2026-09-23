import type { AppSettings, ImportedTheme, ThemePreference } from '@shared/settings';

// Tema RESUELTO: siempre concreto (la UI aplica 'light' o 'dark', nunca 'system').
export type ResolvedTheme = 'light' | 'dark';

// Clave del hint de arranque en localStorage. El fichero de settings (main) es la fuente de verdad; este
// mirror solo sirve para aplicar el tema ANTES de que llegue el settings por IPC (evita el parpadeo).
const STARTUP_THEME_KEY = 'mage-theme';
// Hint de arranque de los tokens de un tema importado (Open VSX): JSON del mapa --color-mg-* -> color.
const STARTUP_CUSTOM_KEY = 'mage-theme-custom';
// Id del elemento <style> que inyecta los overrides del tema importado.
const CUSTOM_STYLE_ID = 'mage-custom-theme';

// Resuelve la preferencia a un tema concreto. PURO: 'system' depende de `prefersDark` (el resultado de
// matchMedia, inyectado por el caller); 'light'/'dark' se devuelven tal cual.
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light';
  return pref;
}

// Aplica el tema resuelto al documento (efecto DOM): fija data-theme en <html> (las variables CSS de
// index.css conmutan por ese atributo) y guarda el hint de arranque. No es puro -> sin unit test.
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(STARTUP_THEME_KEY, resolved);
  } catch {
    // localStorage puede fallar (modo restringido); el hint es opcional, no rompe el flujo.
  }
}

// Lee el hint de arranque para aplicar el tema antes de montar React. Solo acepta valores concretos
// ya validados; cualquier otra cosa -> null (el caller cae a 'dark', el default de la app).
export function readStartupTheme(): ResolvedTheme | null {
  try {
    const value = localStorage.getItem(STARTUP_THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

// Helper de conveniencia: ¿el SO prefiere oscuro? Envuelve matchMedia (inexistente en algún entorno de
// test/headless -> false por defecto). Se usa para resolver 'system'.
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

// --- Temas importados de Open VSX (M3) ---------------------------------------------------------

// Inyecta (o actualiza) los overrides de un tema importado como variables CSS bajo :root. Solo
// sobrescribe los tokens mapeados; los no mapeados caen al tema base (data-theme). Guarda el bloque en
// localStorage para reaplicarlo antes de montar (sin parpadeo). Los valores ya vienen saneados a #rrggbb.
export function applyCustomThemeTokens(tokens: Readonly<Record<string, string>>): void {
  const body = Object.entries(tokens)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  const css = `:root{${body}}`;
  let style = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
  if (style === null) {
    style = document.createElement('style');
    style.id = CUSTOM_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
  try {
    localStorage.setItem(STARTUP_CUSTOM_KEY, JSON.stringify(tokens));
  } catch {
    // localStorage puede fallar (modo restringido); el hint es opcional.
  }
}

// Quita el tema importado (vuelve al tema base) y borra su hint.
export function clearCustomThemeTokens(): void {
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  try {
    localStorage.removeItem(STARTUP_CUSTOM_KEY);
  } catch {
    // idem
  }
}

// Lee el hint de tokens custom del arranque (para aplicarlos antes de montar React). null si no hay o
// no es un objeto plano de string->string.
export function readStartupCustomTokens(): Readonly<Record<string, string>> | null {
  try {
    const raw = localStorage.getItem(STARTUP_CUSTOM_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

// Orquestador: aplica el tema EFECTIVO segun la configuracion. Si hay un tema importado activo, fija su
// tipo como base y sobrescribe sus tokens; si no, aplica el tema base (claro/oscuro/sistema) y limpia
// cualquier override. Es la unica funcion que el store llama para (re)aplicar el tema.
export function applyThemeFromSettings(settings: AppSettings, prefersDark: boolean): void {
  const active = findActiveImportedTheme(settings);
  if (active !== null) {
    applyResolvedTheme(active.type);
    applyCustomThemeTokens(active.tokens);
    applyBackgroundOpacity(settings.backgroundOpacity);
    syncTitleBarOverlay();
    return;
  }
  applyResolvedTheme(resolveTheme(settings.theme, prefersDark));
  clearCustomThemeTokens();
  applyBackgroundOpacity(settings.backgroundOpacity);
  syncTitleBarOverlay();
}

// Los BOTONES de ventana (minimizar/maximizar/cerrar) los sigue pintando el SO, no el DOM: son la
// "non-client area" (Ronda 3, item 9 — "el tema no afecta a la titlebar"). Electron deja recolorearlos
// en caliente con setTitleBarOverlay, asi que se le pasan los colores YA RESUELTOS del tema activo.
// Se leen del DOM (getComputedStyle) en vez de recalcularlos: asi vale igual para los dos temas base y
// para cualquier tema importado, sin duplicar el mapeo en main. Fire-and-forget: que el SO no pueda
// recolorear su barra no debe romper el cambio de tema.
export function syncTitleBarOverlay(): void {
  const styles = getComputedStyle(document.documentElement);
  const color = styles.getPropertyValue('--color-mg-rail').trim();
  const symbolColor = styles.getPropertyValue('--color-mg-sec').trim();
  if (color.length === 0 || symbolColor.length === 0) return;
  void window.mage
    .setTitleBarOverlay({ color, symbolColor })
    .catch((err: unknown) => console.warn('No se pudo recolorear la barra de título:', err));
}

// Devuelve el tema importado activo (activeThemeId presente y existente), o null.
export function findActiveImportedTheme(settings: AppSettings): ImportedTheme | null {
  if (settings.activeThemeId === null) return null;
  return settings.importedThemes.find((t) => t.id === settings.activeThemeId) ?? null;
}

// --- Opacidad de los fondos -----------------------------------------------------------------------

// Id de la hoja que lleva el alfa de las superficies. Aparte de la de temas importados: son dos
// ajustes independientes y mezclarlos haria que cambiar de tema reseteara la opacidad.
const OPACITY_STYLE_ID = 'mage-background-opacity';

// Superficies a las que se aplica el alfa. Son los fondos "de chapa" de la app; NO entran ni bordes,
// ni textos, ni popovers/modales (esos tienen que seguir siendo solidos: un menu translucido sobre un
// chat translucido no se lee), ni los colores semanticos de error o aviso.
const SURFACE_TOKENS = [
  '--color-mg-window',
  '--color-mg-rail',
  '--color-mg-panel',
  '--color-mg-block',
  '--color-mg-tool',
  '--color-mg-code',
] as const;

// Convierte un color CSS a `rgba(...)` con el alfa dado. Acepta las formas que usan los temas de Mage
// y los importados de Open VSX: hex de 3, 6 u 8 digitos y `rgb()`/`rgba()`. Devuelve null si no lo
// entiende — el llamante entonces DEJA ESE TOKEN COMO ESTA, que es mejor que pintar un color inventado.
//
// PURO y exportado para poder probarlo: es la unica parte con aritmetica de la opacidad de fondo.
export function withAlpha(color: string, alpha: number): string | null {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Alfa fuera de rango [0,1]: ${String(alpha)}`);
  }
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    // El hex de 3 se expande duplicando cada digito (#abc -> #aabbcc); el de 8 trae su propio alfa,
    // que se DESCARTA: manda el que pide el usuario.
    const full = digits.length === 3 ? [...digits].map((d) => `${d}${d}`).join('') : digits.slice(0, 6);
    const n = Number.parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb !== null) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }
  return null;
}

// Aplica la opacidad de fondo (50..100). Con 100 se retira la hoja entera y los tokens vuelven a sus
// valores solidos del tema — importante para que el ajuste sea REVERSIBLE de verdad y no deje un
// residuo que tape un cambio de tema.
//
// El color base se LEE del DOM en cada aplicacion en vez de precalcularse: los tokens son los del tema
// activo, que puede ser uno importado y cambiar en caliente. Y la hoja anterior se retira ANTES de
// leer, si no se leeria el color ya mezclado y el alfa se iria componiendo en cada llamada.
export function applyBackgroundOpacity(percent: number): void {
  document.getElementById(OPACITY_STYLE_ID)?.remove();
  if (percent >= 100) return;

  const alpha = Math.min(100, Math.max(50, Math.round(percent))) / 100;
  const computed = getComputedStyle(document.documentElement);
  const rules = SURFACE_TOKENS.map((token) => {
    const rgba = withAlpha(computed.getPropertyValue(token), alpha);
    return rgba === null ? null : `${token}: ${rgba};`;
  }).filter((rule): rule is string => rule !== null);
  if (rules.length === 0) return;

  const style = document.createElement('style');
  style.id = OPACITY_STYLE_ID;
  // `:root:root` gana en especificidad tanto al tema base como a la hoja de un tema importado, sin
  // depender del orden en que se inserten en el <head>.
  style.textContent = `:root:root{${rules.join(' ')}}`;
  document.head.appendChild(style);
}
