import { localized, UserFacingError } from '@shared/i18n/localizedText';

// Cliente de la «frame API» de claude.ai (lista y lectura de artifacts), con el patron de `usageService.ts`: fetch
// inyectado, el token se relee de la cuenta en CADA peticion (nunca se cachea), un 401 renueva la sesion UNA vez y
// el plazo y el tope de tamaño son los del CLI. Medido contra el CLI 2.1.319 (`spike/artifacts-endpoints-spike.mjs`).
//
// SEGURIDAD: el token solo va en la cabecera Authorization hacia api.anthropic.com. Ningun mensaje de error lleva el
// token ni una URL con el token de lectura de un artifact: quien llama pasa una etiqueta sin secretos.

export const FRAME_API_BASE = 'https://api.anthropic.com';
const OAUTH_BETA = 'oauth-2025-04-20';
const FRAME_REFUSAL_TYPE = 'application/vnd.ant.frame-refusal+json';
// Plazo y tope de la lista en el CLI (`timeout` 15 s, `maxContentLength` 4 MiB).
export const FRAME_FETCH_TIMEOUT_MS = 15_000;
export const FRAME_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const HTTP_UNAUTHORIZED = 401;

export interface FrameClientDeps {
  readonly fetch: typeof fetch;
  // Relee <configDir>/.credentials.json y devuelve el accessToken. Lanza si no hay.
  readonly readAccessToken: (configDir: string) => string;
  // `TokenRefreshService.refresh`: el token nuevo o null. Opcional, como en el uso (en desarrollo no se renueva).
  readonly refreshSession?: (configDir: string) => Promise<string | null>;
  // Version del CLI instalado: va en el User-Agent y en `X-Frame-Client-Version`. Puede ser un getter.
  readonly cliVersion: string;
  // `X-Frame-Session-Id`: uno por arranque de Mage.
  readonly sessionId: string;
}

export class FrameClient {
  constructor(private readonly deps: FrameClientDeps) {}

  // GET autenticado a la frame API y su cuerpo JSON. `path` empieza por `/api/frame/`.
  async getJson(accountId: string, path: string): Promise<unknown> {
    const response = await this.authorized(accountId, path);
    const bytes = await readCapped(response, FRAME_MAX_RESPONSE_BYTES, path);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
      throw new Error(`La frame API devolvio algo que no es JSON en ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  // GET SIN OAuth al host del contenido de un artifact (la URL lleva su token de lectura). `label` va en los errores.
  async getAsset(url: string, maxBytes: number, label: string): Promise<Uint8Array> {
    const response = await this.deps.fetch(url, {
      headers: { 'User-Agent': this.userAgent() },
      redirect: 'manual',
      signal: AbortSignal.timeout(FRAME_FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      throw new UserFacingError(localized('errors.artifacts.assetStatus', { status: response.status, file: label }));
    }
    return readCapped(response, maxBytes, label);
  }

  private async authorized(accountId: string, path: string): Promise<Response> {
    const first = await this.request(this.deps.readAccessToken(accountId), path);
    const response = first.status === HTTP_UNAUTHORIZED ? await this.retryAfterRefresh(accountId, path, first) : first;
    if (response.status === HTTP_UNAUTHORIZED) {
      throw new UserFacingError(localized('errors.artifacts.sessionExpired', { account: accountId }));
    }
    if (!response.ok) {
      throw new UserFacingError(localized('errors.artifacts.badStatus', { status: response.status, account: accountId }));
    }
    return response;
  }

  // Un 401 renueva la sesion y repite UNA vez; si el token nuevo vuelve a dar 401, reintentar no arregla nada.
  private async retryAfterRefresh(accountId: string, path: string, unauthorized: Response): Promise<Response> {
    if (this.deps.refreshSession === undefined) return unauthorized;
    const token = await this.deps.refreshSession(accountId);
    if (token === null) return unauthorized;
    return this.request(token, path);
  }

  private request(token: string, path: string): Promise<Response> {
    return this.deps.fetch(FRAME_API_BASE + path, {
      headers: this.headers(token),
      signal: AbortSignal.timeout(FRAME_FETCH_TIMEOUT_MS),
    });
  }

  // Las de `usageService.ts` mas las `X-Frame-*` que manda el CLI (las que midio el spike).
  private headers(token: string): Record<string, string> {
    const version = this.deps.cliVersion;
    return {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA,
      'User-Agent': this.userAgent(),
      Accept: `application/json, ${FRAME_REFUSAL_TYPE}`,
      'X-Frame-CP': 'go',
      'X-Frame-Surface': 'code',
      'X-Frame-Platform': 'cli',
      'X-Frame-Client-Version': version,
      'X-Frame-Session-Id': this.deps.sessionId,
    };
  }

  private userAgent(): string {
    return `claude-code/${this.deps.cliVersion}`;
  }
}

// Lee el cuerpo entero sin pasar de `maxBytes`: corta en cuanto se pasa, sin esperar al final.
export async function readCapped(response: Response, maxBytes: number, label: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(label, maxBytes);
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(label, maxBytes);
    }
    chunks.push(value);
  }
  return concatChunks(chunks, total);
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function tooLarge(label: string, maxBytes: number): UserFacingError {
  return new UserFacingError(localized('errors.artifacts.tooLarge', { file: label, limitKib: Math.floor(maxBytes / 1024) }));
}
