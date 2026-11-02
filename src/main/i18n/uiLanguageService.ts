import { resolveUiLanguageWithFormat, type ResolvedUiLanguage, type UiLanguagePreference } from '@shared/i18n/language';
import { createTranslator, type Translate } from '@shared/i18n/translator';

// Idioma de la interfaz en main (F3.1): lo resuelve UNA vez, lo da a quien lo pida (renderer por IPC; en F3.3 la
// bandeja, los diálogos y los avisos con `translate`) y avisa a todas las ventanas cuando cambia, sin reiniciar.
export interface UiLanguageDeps {
  // Lo guardado en ajustes; undefined = el usuario no ha elegido nada.
  readonly savedPreference: () => UiLanguagePreference | undefined;
  // Preferencia inicial para cuando no hay nada guardado: la elegida en el instalador de Windows (U3). La aporta
  // F3.7; hasta entonces no hay ninguna y se sigue al sistema.
  readonly initialPreference: () => UiLanguagePreference | undefined;
  // `app.getPreferredSystemLanguages()` (respeta LANGUAGE en Linux, medido).
  readonly preferredSystemLanguages: () => readonly string[];
  readonly broadcast: (resolved: ResolvedUiLanguage) => void;
}

export class UiLanguageService {
  private resolved: ResolvedUiLanguage;
  private translator: Translate;

  constructor(private readonly deps: UiLanguageDeps) {
    this.resolved = this.compute();
    this.translator = createTranslator(this.resolved.language);
  }

  current(): ResolvedUiLanguage {
    return this.resolved;
  }

  translate: Translate = (key, ...args) => this.translator(key, ...args);

  // Tras guardar los ajustes: si el idioma resuelto cambió, se rehace el traductor y se avisa a todas las ventanas
  // (la que lo cambió incluida: ninguna lo tiene aplicado aún).
  refresh(): void {
    const next = this.compute();
    if (next.language === this.resolved.language && next.formatLocale === this.resolved.formatLocale && next.systemLanguage === this.resolved.systemLanguage) return;
    this.resolved = next;
    this.translator = createTranslator(next.language);
    this.deps.broadcast(next);
  }

  private compute(): ResolvedUiLanguage {
    const preference = this.deps.savedPreference() ?? this.deps.initialPreference() ?? 'system';
    return resolveUiLanguageWithFormat({ preference, preferredSystemLanguages: this.deps.preferredSystemLanguages() });
  }
}
