import { create } from 'zustand';
import type { Messages } from '@lingui/core';
import type { MageApi } from '@shared/ipc';
import type { ResolvedUiLanguage } from '@shared/i18n/language';
import { COMPILED_CATALOGS, createTranslator, type Translate } from '@shared/i18n/translator';

// Idioma de la interfaz en el renderer (F3.1). Lo resuelve main; aquí vive el traductor activo. Al cambiar, los
// componentes que usan `useT()` se vuelven a pintar sin reiniciar. Lo que no es React usa `t()`, que lee el activo en
// el momento de la llamada (un texto ya guardado en un store no se repinta solo: eso es trabajo de F3.2).

interface UiLanguageState {
  readonly resolved: ResolvedUiLanguage;
  readonly t: Translate;
}

// Hasta que conteste main: castellano, el idioma en que está escrita la interfaz.
const INITIAL: ResolvedUiLanguage = { language: 'es', systemLanguage: 'es', formatLocale: 'es-ES' };

export const useUiLanguageStore = create<UiLanguageState>(() => ({ resolved: INITIAL, t: createTranslator(INITIAL.language) }));

export function useT(): Translate {
  return useUiLanguageStore((s) => s.t);
}

export const t: Translate = (key, ...args) => useUiLanguageStore.getState().t(key, ...args);

// Catálogo del pseudolocale `en-XA`, solo en `pnpm dev` con VITE_MAGE_PSEUDO_LOCALE=1. El import es DINÁMICO y bajo
// `import.meta.env.DEV`: Vite lo reemplaza por `false` al construir y Rollup elimina la rama entera.
async function pseudoMessages(): Promise<Messages | null> {
  if (!import.meta.env.DEV || import.meta.env.VITE_MAGE_PSEUDO_LOCALE !== '1') return null;
  const { pseudoLocalizeCatalog } = await import('@shared/i18n/pseudoLocale');
  return pseudoLocalizeCatalog(COMPILED_CATALOGS.en);
}

export async function applyUiLanguage(resolved: ResolvedUiLanguage): Promise<void> {
  const pseudo = await pseudoMessages();
  const translate = pseudo === null ? createTranslator(resolved.language) : createTranslator('en', pseudo);
  document.documentElement.lang = pseudo === null ? resolved.language : 'en';
  useUiLanguageStore.setState({ resolved, t: translate });
}

// Pide el idioma a main y se suscribe a sus cambios. Devuelve la desuscripción.
export async function initUiLanguage(mage: Pick<MageApi, 'getUiLanguage' | 'onUiLanguageChanged'>): Promise<() => void> {
  const unsubscribe = mage.onUiLanguageChanged((resolved) => void applyUiLanguage(resolved));
  await applyUiLanguage(await mage.getUiLanguage());
  return unsubscribe;
}
