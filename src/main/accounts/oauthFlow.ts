import { z } from 'zod';

// Nucleo PURO de la RENOVACION de sesion por OAuth. Sin efectos: sin red, sin FS, sin Electron.
// Todo lo aqui contenido es determinista (dado el mismo input) y testable en aislamiento.
// SEGURIDAD: este modulo compone cuerpos y mapea respuestas; nunca loguea ni emite el token.
//
// HISTORIA, para que nadie lo "recupere" por error: hasta la Fase 9.2 este fichero tenia tambien el
// flujo de *authorization code* completo (PKCE, URL de authorize, parseo del callback, intercambio del
// code, perfil y roles). Todo eso se BORRO cuando el login paso a hacerlo el CLI: Mage ya no ve un
// token nuevo nunca, asi que no tiene con que canjear un code ni a quien preguntarle el perfil.
//
// Lo que SI se queda, y es una decision explicita del usuario (D7 del plan): **el refresh grant**.
// El panel de Uso consulta un endpoint con el token de la cuenta, y la cuenta que quieres consultar es
// justo la que llevas tiempo sin usar — es decir, la que tiene el token caducado. Sin renovar, esa
// cuenta sale siempre en blanco.

// --- Constantes del protocolo (cliente publico + endpoint) --------------------------------------

// client_id publico de produccion del CLI de Claude Code (OAuth 2.0, cliente publico con PKCE).
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
// Renovacion de tokens (POST JSON). Mismo endpoint que usaba el intercambio del code.
export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
// Scopes del CLI. Solo se usan como RELLENO al leer un `.credentials.json` que no los traiga.
export const SCOPES = [
  'org:create_api_key',
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
] as const;

const MILLIS_PER_SECOND = 1000;

// --- Cuerpo de la renovacion --------------------------------------------------------------------

// Cuerpo JSON del POST de RENOVACION a /v1/oauth/token. El refresh token NUNCA sale de main.
export function buildRefreshBody(refreshToken: string): Record<string, string> {
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new Error('El refresh token no puede estar vacio al renovar la sesion');
  }
  return { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID };
}

// --- Esquemas Zod laxos (frontera: validar tipos, tolerar campos extra) --------------------------

// Objetos anidados tolerantes: validan forma sin exigir campos ni rechazar extras (passthrough).
const accountObject = z
  .object({ uuid: z.string().optional(), email_address: z.string().optional(), display_name: z.string().optional() })
  .passthrough();
const organizationObject = z
  .object({
    uuid: z.string().optional(),
    name: z.string().optional(),
    organization_type: z.string().optional(),
    rate_limit_tier: z.string().optional(),
  })
  .passthrough();

// Respuesta del endpoint de token: access_token es obligatorio (sin el no hay sesion); el resto tolerante.
export const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    // OBLIGATORIOS (B8). Eran `.optional()` y luego se rellenaban con "" y 0, que es peor que
    // fallar: un refreshToken vacio hace que `parseCredentialsSide` marque hasTokens:false, y en el
    // siguiente arranque privado la convergencia PISA el login recien hecho con las credenciales
    // viejas; y sin expires_in la cuenta sale `expired` nada mas renovarse. Si el servidor deja de
    // mandarlos, hay que enterarse en el momento, no tres pantallas despues.
    refresh_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    scope: z.string().optional(),
    account: accountObject.optional(),
    organization: organizationObject.optional(),
  })
  .passthrough();
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// --- Mapeos a las estructuras persistidas -------------------------------------------------------

// Bloque claudeAiOauth de .credentials.json (lo que el CLI espera para operar la suscripcion).
export interface ClaudeAiOauth {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // epoch ms
  readonly scopes: readonly string[];
  readonly subscriptionType: string | null;
  readonly rateLimitTier: string | null;
}

// Bloque claudeAiOauth tras una RENOVACION: `subscriptionType` y `rateLimitTier` se CONSERVAN del
// bloque anterior. Recalcularlos sin perfil los pondria a null y borraria metadata que el CLI usa —
// una renovacion nunca debe empeorar el fichero que encontro. El servidor puede no devolver
// refresh_token nuevo: se rota si viene, y si no se mantiene el que ya habia.
export function toRefreshedOauth(token: TokenResponse, previous: ClaudeAiOauth, now: number): ClaudeAiOauth {
  const scopes = typeof token.scope === 'string' && token.scope.length > 0 ? token.scope.split(' ') : [...previous.scopes];
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token.length > 0 ? token.refresh_token : previous.refreshToken,
    expiresAt: now + token.expires_in * MILLIS_PER_SECOND,
    scopes,
    subscriptionType: previous.subscriptionType,
    rateLimitTier: previous.rateLimitTier,
  };
}

// Esquema del bloque claudeAiOauth TAL COMO ESTA EN DISCO. Frontera: el fichero lo escribe el CLI, asi
// que se valida en vez de confiar. Tolerante con campos extra y con la metadata ausente (el CLI la
// repara); estricto con lo que hace falta para renovar: los dos tokens y la caducidad.
const storedOauthSchema = z
  .object({
    claudeAiOauth: z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        expiresAt: z.number().int().nonnegative(),
        scopes: z.array(z.string()).optional(),
        subscriptionType: z.string().nullable().optional(),
        rateLimitTier: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

// Lee el bloque claudeAiOauth de un `.credentials.json` ya parseado. null si falta o no valida — el
// caller decide (no hay default silencioso posible con credenciales).
export function parseStoredOauth(json: unknown): ClaudeAiOauth | null {
  const parsed = storedOauthSchema.safeParse(json);
  if (!parsed.success) return null;
  const oauth = parsed.data.claudeAiOauth;
  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    scopes: oauth.scopes ?? [...SCOPES],
    subscriptionType: oauth.subscriptionType ?? null,
    rateLimitTier: oauth.rateLimitTier ?? null,
  };
}
