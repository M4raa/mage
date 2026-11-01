import { z } from 'zod';
import type { MessageArgs, MessageKey, MessageValues } from './messageKeys.generated';
import { COMPILED_CATALOGS, createTranslator, type Translate } from './translator';

// Un texto de Mage que viaja como DATO (clave + valores) y lo pinta quien lo enseña, en su idioma (F3.3, INFORME-033 §4).
export interface LocalizedText {
  readonly key: MessageKey;
  readonly values?: Readonly<Record<string, string | number>>;
  // Textos de Mage dentro de este (p. ej. el error que envuelve otro error de Mage): se pintan en el MISMO idioma que
  // el texto de fuera y se pasan como valores con su nombre.
  readonly parts?: Readonly<Record<string, LocalizedText>>;
}

type LooseTranslate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

// Construye un `LocalizedText` comprobando en tipos que la clave existe y que sus valores son los que pide.
export function localized<K extends MessageKey>(key: K, ...args: MessageArgs<K>): LocalizedText {
  return args[0] === undefined ? { key } : { key, values: args[0] as Record<string, string | number> };
}

// Un texto que es SOLO ajeno (error del CLI, de una API, de Node): se enseña tal cual, sin frase de Mage.
export function foreignText(detail: string): LocalizedText {
  return localized('events.detailOnly', { detail });
}

// Claves cuyo mensaje tiene la variable `detail`.
type DetailKey = { [K in MessageKey]: [MessageValues[K]] extends [never] ? never : MessageValues[K] extends { readonly detail: string | number } ? K : never }[MessageKey];

// Un error de Mage que envuelve otro: el de dentro va en `parts.detail` (si es de Mage se traduce igual que el de
// fuera; si es ajeno, `localizedFromError` lo deja tal cual).
export function wrapError<K extends DetailKey>(key: K, values: Omit<MessageValues[K], 'detail'>, err: unknown): LocalizedText {
  return { key, values: values as Record<string, string | number>, parts: { detail: localizedFromError(err) } };
}

// Un texto de Mage con otros textos de Mage dentro. Los nombres de `parts` son variables del mensaje y `values`
// lleva el resto. No se tipa contra la clave (como `localized`): lo cubre el test del módulo que lo use.
export function localizedWithParts(key: MessageKey, values: Readonly<Record<string, string | number>>, parts: Readonly<Record<string, LocalizedText>>): LocalizedText {
  return { key, values, parts };
}

export function renderLocalized(translate: Translate, text: LocalizedText): string {
  // La clave y sus valores ya se tiparon al construirlos con `localized()` o `wrapError()`.
  return (translate as unknown as LooseTranslate)(text.key, valuesWithParts(translate, text));
}

function valuesWithParts(translate: Translate, text: LocalizedText): Readonly<Record<string, string | number>> | undefined {
  if (text.parts === undefined) return text.values;
  const rendered = Object.fromEntries(Object.entries(text.parts).map(([name, part]) => [name, renderLocalized(translate, part)]));
  return { ...text.values, ...rendered };
}

// Es el idioma BASE del catálogo (castellano), NO el de la interfaz: sirve para que el `message` de un error sea legible
// en el log sea cual sea el idioma del usuario.
const BASE_TRANSLATOR = createTranslator('es');

// El texto en castellano (el idioma base del catálogo), para los logs: el log no cambia con el idioma de la interfaz.
export function renderForLog(text: LocalizedText): string {
  return renderLocalized(BASE_TRANSLATOR, text);
}

// El `message` de un UserFacingError es el texto en castellano + esta marca + el JSON de su LocalizedText: así cruza el IPC
// de Electron (que solo conserva `message`) y sigue legible en el log.
export const USER_FACING_MARK = '\u2063';

export class UserFacingError extends Error {
  constructor(readonly localized: LocalizedText) {
    super(renderForLog(localized) + USER_FACING_MARK + JSON.stringify(localized));
    this.name = 'UserFacingError';
  }
}

// Un error envuelto en otro envuelto en otro; más es un JSON que no hemos escrito nosotros.
const MAX_PART_DEPTH = 4;

const encodedTextSchema: z.ZodType<LocalizedText> = z.lazy(() =>
  z
    .object({
      key: z.string().min(1),
      values: z.record(z.union([z.string(), z.number()])).optional(),
      parts: z.record(encodedTextSchema).optional(),
    })
    .strict() as unknown as z.ZodType<LocalizedText>,
);

function isKnownText(text: LocalizedText, depth: number): boolean {
  if (depth > MAX_PART_DEPTH) return false;
  if (!Object.hasOwn(COMPILED_CATALOGS.es, text.key)) return false;
  return Object.values(text.parts ?? {}).every((part) => isKnownText(part, depth + 1));
}

// Un LocalizedText leído de disco o de otra frontera: null si no tiene la forma o alguna clave ya no existe.
export function parseLocalizedText(value: unknown): LocalizedText | null {
  const checked = encodedTextSchema.safeParse(value);
  if (!checked.success) return null;
  return isKnownText(checked.data, 1) ? checked.data : null;
}

// Frontera: devolver null aquí es un resultado válido («este mensaje no viene de un UserFacingError»), no un fallo
// silenciado. Busca la ÚLTIMA marca porque Electron antepone su prefijo al mensaje.
export function decodeUserFacingMessage(message: string): LocalizedText | null {
  const at = message.lastIndexOf(USER_FACING_MARK);
  if (at < 0) return null;
  return parseLocalizedText(parseJson(message.slice(at + USER_FACING_MARK.length)));
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // no es JSON: lo trata decodeUserFacingMessage como «no es un UserFacingError»
  }
}

export function localizedFromError(err: unknown): LocalizedText {
  if (err instanceof UserFacingError) return err.localized;
  if (err instanceof Error) return decodeUserFacingMessage(err.message) ?? foreignText(err.message);
  return foreignText(String(err));
}
