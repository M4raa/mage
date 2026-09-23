import type { LogLevel } from '@shared/debug';
import { buildRefreshBody, toRefreshedOauth, tokenResponseSchema, TOKEN_URL, type ClaudeAiOauth } from './oauthFlow';

// Renovacion del accessToken de una cuenta (refresh grant de OAuth), para que el panel de Uso siga
// funcionando en cuentas que llevan tiempo sin usarse. Normalmente quien renueva es el CLI al correr un
// turno; esto cubre el hueco de la cuenta inactiva, que es justo la que quieres consultar.
//
// SEGURIDAD: ni el accessToken ni el refreshToken se loguean ni cruzan el IPC. El resultado que sale de
// aqui es el accessToken nuevo, que solo consume UsageService para su header Authorization.
//
// PRECIO CONOCIDO: esto es un grant de OAuth ejecutado por Mage y una reescritura de credenciales. Es lo
// mismo que el login delega en el CLI, y se hace aqui a peticion explicita (decision del 2026-09-14,
// registrada en la auditoria). El CLI no ofrece ningun comando barato que fuerce el refresco:
// `claude auth status` NO lo hace (medido el 2026-09-14).

const HTTP_TIMEOUT_MS = 15_000;

export interface TokenRefreshDeps {
  readonly fetch: typeof fetch;
  // Lee el bloque claudeAiOauth completo de <configDir>/.credentials.json, o null si no hay o no vale.
  readonly readOauthBlock: (configDir: string) => ClaudeAiOauth | null;
  // Escritura atomica del bloque renovado (la misma que usa el login).
  readonly writeOauthBlock: (configDir: string, oauth: ClaudeAiOauth) => void;
  readonly now: () => number;
  readonly log: (level: LogLevel, message: string) => void;
}

export class TokenRefreshService {
  // Una renovacion en vuelo por cuenta: dos paneles pidiendo uso a la vez no deben lanzar dos grants
  // contra el mismo refresh token (el servidor puede rotarlo y la segunda llegaria con uno ya gastado).
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(private readonly deps: TokenRefreshDeps) {}

  // Devuelve el accessToken nuevo, o null si no se pudo renovar (sin credenciales, red caida, o el
  // servidor rechaza el refresh token porque caduco tambien). Nunca lanza: el caller decide que hacer.
  async refresh(configDir: string): Promise<string | null> {
    if (typeof configDir !== 'string' || configDir.trim().length === 0) {
      throw new Error(`configDir invalido para renovar la sesion: "${configDir}"`);
    }

    const running = this.inFlight.get(configDir);
    if (running !== undefined) return running;

    const attempt = this.runRefresh(configDir).finally(() => this.inFlight.delete(configDir));
    this.inFlight.set(configDir, attempt);
    return attempt;
  }

  private async runRefresh(configDir: string): Promise<string | null> {
    const previous = this.deps.readOauthBlock(configDir);
    if (previous === null || previous.refreshToken.length === 0) {
      this.deps.log('warn', `No se puede renovar la sesion de ${configDir}: no hay refresh token en el fichero`);
      return null;
    }

    const token = await this.postRefresh(previous.refreshToken, configDir);
    if (token === null) return null;

    const refreshed = toRefreshedOauth(token, previous, this.deps.now());
    try {
      this.deps.writeOauthBlock(configDir, refreshed);
    } catch (err) {
      // El token nuevo es valido pero no se pudo persistir: no se devuelve, porque usarlo dejaria el
      // fichero con el viejo y el siguiente arranque volveria a fallar sin explicacion.
      this.deps.log('error', `Sesion renovada pero no se pudo escribir en ${configDir}: ${errorText(err)}`);
      return null;
    }
    this.deps.log('info', `Sesion renovada para ${configDir}`);
    return refreshed.accessToken;
  }

  // POST del grant. Devuelve el token validado, o null en cualquier fallo (red, !ok, esquema invalido).
  // El cuerpo de la respuesta NUNCA se incluye en la traza: llevaria credenciales.
  private async postRefresh(refreshToken: string, configDir: string): Promise<ReturnType<typeof tokenResponseSchema.parse> | null> {
    try {
      const response = await this.deps.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildRefreshBody(refreshToken)),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.deps.log('warn', `El refresh de ${configDir} respondio ${response.status} ${response.statusText}`);
        return null;
      }
      const parsed = tokenResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        this.deps.log('warn', `El refresh de ${configDir} devolvio una respuesta que no valida el esquema`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.deps.log('warn', `Fallo de red al renovar la sesion de ${configDir}: ${errorText(err)}`);
      return null;
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
