import { createHmac, timingSafeEqual } from 'node:crypto';

// Token del host local (F2.6): 32 bytes aleatorios, rotado en cada arranque, en un fichero que solo lee el
// usuario. NUNCA viaja por variable de entorno (así `scrubAgentEnv` y cualquier hijo no lo ven), ni al renderer,
// ni a un log. Este módulo no lo imprime en ningún mensaje de error.

export const TOKEN_BYTES = 32;
export const TOKEN_FILE_MODE = 0o600;

export interface TokenDeps {
  readonly randomBytes: (size: number) => Buffer;
}

export function createHostToken(deps: TokenDeps): string {
  const bytes = deps.randomBytes(TOKEN_BYTES);
  if (bytes.length !== TOKEN_BYTES) throw new Error(`El generador de aleatorios devolvió ${bytes.length} bytes y se esperaban ${TOKEN_BYTES}`);
  return bytes.toString('hex');
}

// Comparación en tiempo constante. Dos longitudes distintas no son iguales, pero tampoco se compara byte a byte:
// se compara el esperado consigo mismo para que el coste no dependa de dónde difiere lo recibido.
export function tokenMatches(expected: string, received: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(received, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

// Reto del cliente (F7.1): el cliente manda un nonce aleatorio y el host responde con el HMAC-SHA256 del token
// sobre ese nonce, así demuestra que tiene el token SIN que el cliente lo envíe. Cubre un impostor que ocupó el
// nombre del pipe antes de que arrancara el host y un token que quedó en disco tras una caída. El prefijo de
// contexto impide que esta prueba sirva para cualquier otro uso del mismo HMAC.
export const CHALLENGE_NONCE_BYTES = 32;
export const CHALLENGE_CONTEXT = 'mage-host-challenge-v1:';

export function challengeProof(token: string, nonce: string): string {
  if (token.length === 0) throw new Error('El token del host está vacío: no se puede responder al reto');
  return createHmac('sha256', token).update(`${CHALLENGE_CONTEXT}${nonce}`, 'utf8').digest('hex');
}
