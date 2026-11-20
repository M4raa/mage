// Reintentos de conexión del cliente de terminal (F7.3, D4): 3 intentos con esperas de 1, 2 y 4 s. Un impostor
// (`NOT_MAGE_SERVER`) y una terminal que ya no está emparejada no se reintentan. Puro: `connect`, `sleep` y `onAttempt` llegan por parámetro.
import { NOT_MAGE_SERVER } from './hostLink.mjs';
import { isNotPairedError } from './pairing.mjs';

export const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function reconnectWithRetries({ connect, sleep, onAttempt }) {
  let lastError;
  for (const [index, ms] of RETRY_DELAYS_MS.entries()) {
    onAttempt(index + 1, ms);
    await sleep(ms);
    try {
      return await connect();
    } catch (error) {
      if (error instanceof Error && error.message === NOT_MAGE_SERVER) throw error;
      // Revocada en Mage: reintentar no la vuelve a emparejar.
      if (isNotPairedError(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(`No se pudo reconectar con Mage tras ${RETRY_DELAYS_MS.length} intentos`, { cause: lastError });
}
