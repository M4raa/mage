import { z } from 'zod';
import type { MessageArgs, MessageKey } from './messageKeys.generated';
import { COMPILED_CATALOGS, createTranslator, type Translate } from './translator';

// Un texto de Mage que viaja como DATO (clave + valores) y lo pinta quien lo enseña, en su idioma (F3.3, INFORME-033 §4).
export interface LocalizedText {
  readonly key: MessageKey;
  readonly values?: Readonly<Record<string, string | number>>;
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

export function renderLocalized(translate: Translate, text: LocalizedText): string {
  // La clave y sus valores ya se tiparon al construirlos con `localized()`.
  return (translate as unknown as LooseTranslate)(text.key, text.values);
}

// Es el idioma BASE del catálogo (castellano), NO el de la interfaz: sirve para que el `message` de un error sea legible
// en el log sea cual sea el idioma del usuario.
const BASE_TRANSLATOR = createTranslator('es');

// El `message` de un UserFacingError es el texto en castellano + esta marca + el JSON de su LocalizedText: así cruza el IPC
// de Electron (que solo conserva `message`) y sigue legible en el log.
export const USER_FACING_MARK = '\u2063';

export class UserFacingError extends Error {
  constructor(readonly localized: LocalizedText) {
    super(renderLocalized(BASE_TRANSLATOR, localized) + USER_FACING_MARK + JSON.stringify(localized));
    this.name = 'UserFacingError';
  }
}

const encodedTextSchema = z.object({ key: z.string().min(1), values: z.record(z.union([z.string(), z.number()])).optional() }).strict();

// Frontera: devolver null aquí es un resultado válido («este mensaje no viene de un UserFacingError»), no un fallo
// silenciado. Busca la ÚLTIMA marca porque Electron antepone su prefijo al mensaje.
export function decodeUserFacingMessage(message: string): LocalizedText | null {
  const at = message.lastIndexOf(USER_FACING_MARK);
  if (at < 0) return null;
  const parsed = parseJson(message.slice(at + USER_FACING_MARK.length));
  const checked = encodedTextSchema.safeParse(parsed);
  if (!checked.success) return null;
  if (!Object.hasOwn(COMPILED_CATALOGS.es, checked.data.key)) return null;
  return checked.data as LocalizedText;
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
