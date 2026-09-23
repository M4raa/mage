import type { UsageInfo, UsageWindowInfo } from '@shared/usage';
import { toUsageInfo, UsageResponseSchema } from './schemas';
import { clearLockout, EMPTY_LOCKOUT_STATE, isLockedOut, lockOut, remainingLockoutMs, type LockoutState } from './lockoutPolicy';

// Endpoint de uso (por cuenta). Consume la SUSCRIPCION via el token OAuth de la cuenta.
const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
// Header beta imprescindible del endpoint OAuth.
const OAUTH_BETA = 'oauth-2025-04-20';
// TTL de cache por defecto: >=180 s. El endpoint devuelve un entero grueso con lag, asi que pedir
// mas a menudo no aporta datos frescos y solo gastaria red.
const DEFAULT_CACHE_TTL_MS = 180_000;
// Plazo maximo de una consulta HTTP. Sin el, una conexion colgada deja el panel girando PARA
// SIEMPRE, sin error y sin forma de reintentar. Mismo patron que ya usaba themeMarketService.
const FETCH_TIMEOUT_MS = 15_000;

// 401 del endpoint = el accessToken del fichero ha caducado. No se recupera solo ni reintentando:
// solo lo renueva el CLI la proxima vez que corra un turno sobre esa cuenta. Sin cooldown, cada
// refresco del panel volveria a preguntar con el mismo token muerto.
const UNAUTHORIZED_COOLDOWN_MS = 5 * 60_000;
const HTTP_UNAUTHORIZED = 401;

// Cooldown tras un 429 (I8, patron TTL+cooldown APILADOS de OmniRoute): el TTL
// de arriba evita pedir mas a menudo de lo normal, pero un 429 real dice que el endpoint YA esta
// saturado — sin esto, la siguiente consulta (otra cuenta refrescando el panel de Uso, o el propio
// polling) repetiria la misma pregunta contra un endpoint que acaba de decir que no. Fallback cuando
// la respuesta no trae `Retry-After`: se prefiere siempre el valor real del servidor si esta presente.
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
// Tope del cooldown (B13d). El `Retry-After` lo pone el servidor y no se valida contra nada: un
// 86400 dejaba el panel de Uso muerto 24 h, y el lockout SOLO se limpia con un fetch correcto, que
// el propio lockout impide — o sea que no se recuperaba hasta reiniciar Mage. Cinco minutos es de
// sobra para un rate limit y deja la puerta abierta a reintentar.
const MAX_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

// Dependencias inyectables -> modulo testeable sin tocar red/FS/reloj reales.
export interface UsageDeps {
  // fetch inyectado (el global de Node 22 en produccion; un mock en tests).
  readonly fetch: typeof fetch;
  // Relee <configDir>/.credentials.json y devuelve el accessToken. Se llama en CADA miss de cache
  // (el CLI puede haber refrescado el fichero); el token NUNCA se cachea en memoria aqui.
  readonly readAccessToken: (configDir: string) => string;
  // Reloj inyectado (para la cache y fetchedAt).
  readonly now: () => number;
  // "claude-code/<version>". Imprescindible o el endpoint responde 429.
  readonly userAgent: string;
  // TTL de cache (>=180 s). Opcional: default DEFAULT_CACHE_TTL_MS.
  readonly cacheTtlMs?: number;
  // Traza opcional. La usa el unico camino que degrada en vez de fallar: la sesion caducada (401),
  // que sirve el ultimo valor conocido. Sin esto, la degradacion seria silenciosa.
  readonly log?: (level: 'warn', message: string) => void;
  // Renovacion de la sesion ante un 401 (TokenRefreshService). Devuelve el accessToken nuevo o null si
  // no se pudo. OPCIONAL: sin ella el 401 degrada al ultimo valor conocido, que es el comportamiento
  // base. Nunca lanza — un fallo al renovar no debe convertirse en un fallo del panel.
  readonly refreshSession?: (configDir: string) => Promise<string | null>;
}

// Ventana sin dato: es lo que ya significa `utilization: 0` + `resetsAt: null` en el resto del panel.
const UNKNOWN_WINDOW: UsageWindowInfo = { utilization: 0, resetsAt: null };

interface CacheEntry {
  readonly fetchedAt: number;
  readonly data: UsageInfo;
}

// Foto de consumo que el CLI regala en su stream (Fase 9.3, medida en S3). Se guarda APARTE de la
// cache del endpoint a proposito: el stream trae las dos ventanas y nada mas, asi que mezclarlo en
// la misma entrada borraria `limits` y `apiCreditsMinor`, que solo sabe el endpoint.
export interface StreamUsageWindows {
  readonly fiveHour: UsageWindowInfo | null;
  readonly sevenDay: UsageWindowInfo | null;
}

interface StreamEntry extends StreamUsageWindows {
  readonly at: number;
}

// Servicio de uso por cuenta. SEGURIDAD: lee el token SOLO para el header Authorization; jamas lo
// loguea/emite. Al renderer solo cruza UsageInfo (agregado, sin token). Cachea por configDir >=180 s.
export class UsageService {
  private readonly cache = new Map<string, CacheEntry>();
  // Ultima foto del stream por configDir (Fase 9.3). No caduca por si sola: la sustituye la
  // siguiente del mismo turno, y al servir se compara su marca con la del endpoint.
  private readonly streamCache = new Map<string, StreamEntry>();
  // Por configDir: cooldown tras un 429 (I9: modulo puro compartido en vez del Map casero de I8).
  private lockouts: LockoutState = EMPTY_LOCKOUT_STATE;
  private readonly ttlMs: number;

  constructor(private readonly deps: UsageDeps) {
    this.ttlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  // Registra la foto que el CLI emitio en el stream de un turno de esta cuenta. Es GRATIS (no gasta
  // red) y llega en cada turno, asi que es la fuente mas fresca que hay de las dos ventanas.
  //
  // Una foto con las DOS ventanas a null no se guarda: null significa "no se sabe", y guardar un
  // "no se sabe" con fecha nueva solo serviria para tapar un dato bueno mas antiguo.
  recordStreamUsage(configDir: string, windows: StreamUsageWindows): void {
    if (typeof configDir !== 'string' || configDir.trim().length === 0) {
      throw new Error(`configDir invalido al registrar el uso del stream: "${configDir}"`);
    }
    if (windows.fiveHour === null && windows.sevenDay === null) return;
    this.streamCache.set(configDir, { ...windows, at: this.deps.now() });
  }

  // Devuelve el uso de una cuenta. Sirve de cache si la entrada es reciente (< ttl); si no, relee el
  // token, consulta el endpoint, valida y cachea. Lanza Error (con status, nunca el token) en fallo.
  async getUsage(configDir: string): Promise<UsageInfo> {
    if (typeof configDir !== 'string' || configDir.trim().length === 0) {
      throw new Error(`configDir invalido para consultar uso: "${configDir}"`);
    }

    const cached = this.cache.get(configDir);
    const nowMs = this.deps.now();
    if (cached !== undefined && nowMs - cached.fetchedAt < this.ttlMs) {
      return this.withStreamWindows(configDir, cached.data);
    }

    if (isLockedOut(this.lockouts, configDir, nowMs)) {
      const remainingMs = remainingLockoutMs(this.lockouts, configDir, nowMs);
      return this.staleOrThrow(configDir, `El endpoint de uso esta en cooldown (quedan ${Math.ceil(remainingMs / 1000)} s) para ${configDir}`);
    }

    const first = await this.requestUsage(this.deps.readAccessToken(configDir));
    const response = first.status === HTTP_UNAUTHORIZED ? await this.retryAfterRefresh(configDir, first) : first;
    if (!response.ok) {
      if (response.status === HTTP_UNAUTHORIZED) return this.onUnauthorized(configDir, nowMs);
      if (response.status === 429) {
        this.lockouts = lockOut(this.lockouts, configDir, nowMs, rateLimitCooldownMsFrom(response));
      }
      // Mensaje sin token: solo status/statusText y la cuenta afectada.
      throw new Error(`El endpoint de uso respondio ${response.status} ${response.statusText} para ${configDir}`);
    }
    this.lockouts = clearLockout(this.lockouts, configDir);

    const parsed = UsageResponseSchema.parse(await response.json());
    const data = toUsageInfo(parsed, nowMs);
    this.cache.set(configDir, { fetchedAt: nowMs, data });
    return this.withStreamWindows(configDir, data);
  }

  // La consulta al endpoint. Extraida para poder repetirla con un token nuevo sin duplicar cabeceras.
  private requestUsage(token: string): Promise<Response> {
    return this.deps.fetch(USAGE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': this.deps.userAgent,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  }

  // Ante un 401 renueva la sesion y repite la consulta UNA sola vez. Si el token recien renovado vuelve
  // a dar 401, el problema no es la caducidad y reintentar solo gastaria red. Sin renovador inyectado
  // (o si la renovacion falla) se devuelve el 401 original y decide `onUnauthorized`.
  private async retryAfterRefresh(configDir: string, unauthorized: Response): Promise<Response> {
    if (this.deps.refreshSession === undefined) return unauthorized;
    const token = await this.deps.refreshSession(configDir);
    if (token === null) return unauthorized;
    return this.requestUsage(token);
  }

  // Sesion caducada y no se ha podido renovar (o no hay renovador). Se pone cooldown para no machacar un
  // token muerto y se sirve el ultimo valor conocido: su `fetchedAt` ya delata la antiguedad en el
  // renderer. Sin valor previo no hay nada que degradar y se lanza con el motivo.
  private onUnauthorized(configDir: string, nowMs: number): UsageInfo {
    this.lockouts = lockOut(this.lockouts, configDir, nowMs, UNAUTHORIZED_COOLDOWN_MS);
    this.deps.log?.('warn', `Sesion caducada al consultar el uso de ${configDir}; el CLI la renovara en el siguiente turno de esa cuenta`);
    return this.staleOrThrow(configDir, `La sesion de la cuenta ha caducado (401) y no hay uso previo que mostrar para ${configDir}`);
  }

  // Ultimo valor conocido cuando no se puede preguntar (cooldown o sesion caducada). Desde 9.3 hay
  // DOS fuentes de "ultimo valor": la del endpoint y la del stream, que no gasta red y por tanto
  // sigue llegando aunque el endpoint este caido o la sesion del panel de uso no valga. Sin ninguna
  // de las dos no hay nada que degradar: se lanza con el motivo, nunca un default silencioso.
  private staleOrThrow(configDir: string, reason: string): UsageInfo {
    const stale = this.cache.get(configDir);
    if (stale !== undefined) return this.withStreamWindows(configDir, stale.data);
    const stream = this.streamCache.get(configDir);
    if (stream === undefined) throw new Error(reason);
    // Solo ventanas: `limits` y `apiCreditsMinor` no los sabe el stream, y fingirlos seria peor que
    // decir que no hay. Vacio/null es lo que ya significa "sin dato" en este tipo.
    return {
      fiveHour: stream.fiveHour ?? UNKNOWN_WINDOW,
      sevenDay: stream.sevenDay ?? UNKNOWN_WINDOW,
      limits: [],
      apiCreditsMinor: null,
      fetchedAt: stream.at,
    };
  }

  // Superpone las ventanas del stream sobre lo que dio el endpoint, y SOLO si son mas recientes.
  // Nunca al reves y nunca parcialmente a ciegas: una ventana null del stream deja la del endpoint.
  // `fetchedAt` pasa a ser el del stream porque es la marca del dato que se esta ENSENANDO (las
  // ventanas); dejar el del endpoint haria parecer viejo un numero que acaba de llegar.
  private withStreamWindows(configDir: string, info: UsageInfo): UsageInfo {
    const stream = this.streamCache.get(configDir);
    if (stream === undefined || stream.at <= info.fetchedAt) return info;
    return {
      ...info,
      fiveHour: stream.fiveHour ?? info.fiveHour,
      sevenDay: stream.sevenDay ?? info.sevenDay,
      fetchedAt: stream.at,
    };
  }
}

// Duracion del cooldown a partir de la respuesta 429: se prefiere el `Retry-After` real del servidor
// (segundos) sobre el fallback fijo. Cualquier valor no numerico/no positivo se ignora sin lanzar —
// esto es un dato de cortesia del servidor, no algo que deba tumbar la peticion si viene mal formado.
function rateLimitCooldownMsFrom(response: Response): number {
  const header = response.headers?.get?.('retry-after') ?? null;
  if (header === null) return Math.min(DEFAULT_RATE_LIMIT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS);
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return Math.min(DEFAULT_RATE_LIMIT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS);
  return Math.min(seconds * 1000, MAX_RATE_LIMIT_COOLDOWN_MS);
}
