import { timingSafeEqual } from 'node:crypto';

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
