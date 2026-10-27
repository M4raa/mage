import { describe, expect, it, vi } from 'vitest';
import type { UiLanguagePreference } from '@shared/i18n/language';
import { UiLanguageService, type UiLanguageDeps } from './uiLanguageService';

function deps(over: Partial<UiLanguageDeps> = {}): UiLanguageDeps {
  return {
    savedPreference: () => undefined,
    initialPreference: () => undefined,
    preferredSystemLanguages: () => ['es-ES', 'en-US'],
    broadcast: vi.fn(),
    ...over,
  };
}

describe('UiLanguageService', () => {
  it('current_sinNadaGuardadoNiInicial_sigueAlSistema', () => {
    expect(new UiLanguageService(deps()).current()).toEqual({ language: 'es', systemLanguage: 'es', formatLocale: 'es-ES' });
  });

  it('current_sinNadaGuardado_heredaLaPreferenciaInicial', () => {
    // U3: lo elegido en el instalador se hereda SOLO si el usuario no ha guardado nada.
    expect(new UiLanguageService(deps({ initialPreference: () => 'en' })).current().language).toBe('en');
  });

  it('current_conPreferenciaGuardada_ignoraLaInicial', () => {
    const service = new UiLanguageService(deps({ savedPreference: () => 'system', initialPreference: () => 'en' }));

    expect(service.current().language).toBe('es');
  });

  it('refresh_cambiaElIdioma_avisaUnaVezYTraduceEnElNuevo', () => {
    let saved: UiLanguagePreference | undefined;
    const broadcast = vi.fn();
    const service = new UiLanguageService(deps({ savedPreference: () => saved, broadcast }));
    expect(service.translate('settings.language.system')).toBe('Sistema');

    saved = 'en';
    service.refresh();
    service.refresh();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ language: 'en', systemLanguage: 'es', formatLocale: 'en-US' });
    expect(service.translate('settings.language.system')).toBe('System');
  });

  it('refresh_sinCambio_noAvisa', () => {
    const broadcast = vi.fn();
    const service = new UiLanguageService(deps({ broadcast }));

    service.refresh();

    expect(broadcast).not.toHaveBeenCalled();
  });
});
