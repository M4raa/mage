// El texto de un error para la interfaz, en un solo sitio para todo el renderer (respuesta 3 de la devolución 17).
// Lo que lanza un handler de main llega envuelto por Electron: «Error invoking remote method '<canal>': Error: <mensaje
// de main>». Se quita SOLO ese prefijo conocido, al principio; el mensaje de main queda intacto (un tipo distinto de
// `Error`, p. ej. `TypeError: …`, se conserva porque dice algo). Contrato de error: si no es un Error, el valor recibido.
import { decodeUserFacingMessage, renderLocalized } from '@shared/i18n/localizedText';
import { t } from '../i18n/uiLanguage';

const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return t('errors.workbench.unknownError', { value: String(err) });
  const message = err.message.replace(IPC_ERROR_PREFIX, '');
  const localizedMessage = decodeUserFacingMessage(message);
  return localizedMessage === null ? message : renderLocalized(t, localizedMessage);
}
