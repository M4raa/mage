import { foreignText, renderLocalized, UserFacingError, type LocalizedText } from '@shared/i18n/localizedText';
import { createTranslator } from '@shared/i18n/translator';

// Ayudas de los tests de lo que viaja como `LocalizedText` (F3.3b): pintar en castellano y sacar el texto de lo que lanza
// main. Este directorio lo compilan node y web.

const ES = createTranslator('es');

// El texto en castellano de un `LocalizedText` (`null` se pinta como «(null)» para que el test falle con un valor legible).
export function esText(value: LocalizedText | null): string {
  return renderLocalized(ES, value ?? foreignText('(null)'));
}

// El `LocalizedText` de lo que lanza `run`. Falla si no lanza o si lanza otra cosa que un `UserFacingError`.
export function thrownText(run: () => unknown): LocalizedText {
  try {
    run();
  } catch (error) {
    if (error instanceof UserFacingError) return error.localized;
    throw error;
  }
  throw new Error('se esperaba un UserFacingError y no lanzó nada');
}

// El mensaje de `JSON.parse` para un texto que no es JSON (lo que los errores de main llevan como texto ajeno).
export function jsonMessage(raw: string): string {
  try {
    JSON.parse(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`se esperaba un JSON inválido: ${raw}`);
}
