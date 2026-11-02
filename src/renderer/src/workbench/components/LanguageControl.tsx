import { UI_LANGUAGE_PREFERENCES, type UiLanguage, type UiLanguagePreference } from '@shared/i18n/language';
import { useT, useUiLanguageStore } from '../../i18n/uiLanguage';
import { useWorkbenchStore } from '../workbenchStore';

// Nombre de cada opción. Los idiomas van por su ENDÓNIMO (no se traducen: quien no entiende el idioma actual tiene que
// reconocer el suyo).
type OptionKey = 'settings.language.system' | 'settings.language.es' | 'settings.language.en';
const LABEL: Readonly<Record<UiLanguagePreference, OptionKey>> = {
  system: 'settings.language.system',
  es: 'settings.language.es',
  en: 'settings.language.en',
};
const ENDONYM: Readonly<Record<UiLanguage, OptionKey>> = { es: 'settings.language.es', en: 'settings.language.en' };

// Selector de idioma de Configuración › Apariencia (F3.1): «Sistema / Español / English». Se aplica al instante.
// Sin preferencia guardada, la opción marcada es «Sistema» (es lo que se usa mientras el usuario no elija).
export function LanguageControl(): React.JSX.Element {
  const t = useT();
  const preference = useWorkbenchStore((s) => s.settings.uiLanguage) ?? 'system';
  const setUiLanguage = useWorkbenchStore((s) => s.setUiLanguage);
  const systemLanguage = useUiLanguageStore((s) => s.resolved.systemLanguage);
  return (
    <div className="flex flex-col gap-[8px]" data-setting="ui-language">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.language.label')}</span>
      <div className="flex gap-[8px]" role="radiogroup" aria-label={t('settings.language.label')}>
        {UI_LANGUAGE_PREFERENCES.map((option) => {
          const selected = option === preference;
          return (
            <button
              key={option}
              role="radio"
              aria-checked={selected}
              data-language={option}
              onClick={() => setUiLanguage(option)}
              className={`flex-1 rounded-[8px] border px-[12px] py-[10px] text-left ${
                selected ? 'border-mg-focus bg-mg-sel text-mg-text' : 'border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover'
              }`}
            >
              <div className="text-[12px] font-semibold">{t(LABEL[option])}</div>
              {option === 'system' ? (
                <div className="mt-[3px] text-[10.5px] leading-[1.4] text-mg-ter">
                  {t('settings.language.systemHint', { language: t(ENDONYM[systemLanguage]) })}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      <span className="text-[10.5px] text-mg-muted">{t('settings.language.hint')}</span>
    </div>
  );
}
