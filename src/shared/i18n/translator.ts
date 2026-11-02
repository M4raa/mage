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

// `@lingui/core` decodifica `\xHH` y `\uHHHH` en el texto YA interpolado (medido en 6.10.1): una ruta de Windows como
// `C:\x86tools` salía como `C:` + un carácter de control + `tools`. Las barras de los VALORES se sustituyen por una
// marca antes de interpolar y se restauran después. Los mensajes del catálogo no pueden llevar esas secuencias
// (`pnpm i18n:check` lo rechaza).
// ponytail: un valor que ya contenga U+E000 (uso privado) saldría con barras; si llegara a pasar, otra marca.
const BACKSLASH_MARK = '\uE000';

type Values = Readonly<Record<string, unknown>> | undefined;
function guardBackslashes(values: Values): Values {
  if (values === undefined) return undefined;
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'string' ? value.replaceAll('\\', BACKSLASH_MARK) : value]));
}

// Traductor de un idioma. `messages` sustituye al catálogo compilado (el pseudolocale de desarrollo lo usa).
export function createTranslator(language: UiLanguage, messages: Messages = COMPILED_CATALOGS[language]): Translate {
  const i18n = setupI18n({ locale: language, messages: { [language]: messages } });
  return (key, ...args) => i18n._(key, guardBackslashes(args[0] as Values) as Record<string, unknown> | undefined).replaceAll(BACKSLASH_MARK, '\\');
}
