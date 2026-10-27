import { setupI18n, type Messages } from '@lingui/core';
import { messages as enMessages } from './catalogs/en.json?lingui';
import { messages as esMessages } from './catalogs/es.json?lingui';
import type { UiLanguage } from './language';
import type { MessageArgs, MessageKey } from './messageKeys.generated';

// El envoltorio ÚNICO sobre la biblioteca (T1 de DEVOLUCION-018: Lingui; si hubiera que cambiarla, solo cambia este
// fichero). Lo usan main y renderer y, en F7, la terminal. Los catálogos llegan YA compilados por
// `@lingui/vite-plugin` (sufijo `?lingui`): en el build no viaja ningún compilador de mensajes.

export type Translate = <K extends MessageKey>(key: K, ...args: MessageArgs<K>) => string;

export const COMPILED_CATALOGS: Readonly<Record<UiLanguage, Messages>> = { es: esMessages, en: enMessages };

// Traductor de un idioma. `messages` sustituye al catálogo compilado (el pseudolocale de desarrollo lo usa).
export function createTranslator(language: UiLanguage, messages: Messages = COMPILED_CATALOGS[language]): Translate {
  const i18n = setupI18n({ locale: language, messages: { [language]: messages } });
  return (key, ...args) => i18n._(key, args[0]);
}
