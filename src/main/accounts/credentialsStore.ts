import { join } from 'node:path';
import type { ClaudeAiOauth } from './oauthFlow';

// Writer del fichero de credenciales. Replica el formato exacto que el CLI espera para que
// AccountService/UsageService funcionen sin tocar nada:
//   - <configDir>/.credentials.json (0600): { claudeAiOauth: {...} } — MERGE (preserva claves ajenas).
// SEGURIDAD: escribe el token en disco (es su cometido) pero NUNCA lo loguea ni lo devuelve.
// DI de FS -> testable con mocks; escritura atomica (tmp+rename) delegada al caller.
//
// Desde la Fase 9.2 su UNICO llamante es la RENOVACION de sesion del panel de Uso (decision D7): el
// login ya no pasa por aqui, lo hace el CLI. Escribia tambien el bloque `oauthAccount` de
// `.claude.json` (`mergeOauthAccount`, borrado): dependia de consultar el perfil con un token recien
// obtenido, y Mage ya no obtiene ninguno. Si algun dia hace falta el email de la cuenta y el CLI no
// lo hubiera escrito, la respuesta NO es resucitar ese writer, es `auth status --json` — que esta
// medido y ya trae `email` y `orgName`.

const CREDENTIALS_FILE = '.credentials.json';

// Dependencias inyectables de FS. `readJson` devuelve null si el fichero no existe, es ilegible o el
// JSON es invalido (misma frontera tolerante que AccountService). `writeFileAtomic` debe escribir de
// forma atomica (tmp + rename). `chmod600` restringe permisos (no-op documentado en win32).
export interface CredentialsDeps {
  readonly readJson: (path: string) => unknown;
  readonly writeFileAtomic: (path: string, content: string) => void;
  readonly chmod600: (path: string) => void;
  readonly exists: (path: string) => boolean;
}

// Escribe el bloque claudeAiOauth en <configDir>/.credentials.json preservando cualquier clave ajena
// de nivel superior. Si el fichero existente es ilegible, se parte de {} (es NUESTRO fichero de
// credenciales: sobrescribir es aceptable, no hay estado ajeno critico que proteger). Tras escribir,
// se aplican permisos 0600.
export function writeCredentials(configDir: string, creds: ClaudeAiOauth, deps: CredentialsDeps): void {
  if (configDir.length === 0) throw new Error('El configDir no puede estar vacio al escribir credenciales');

  const path = join(configDir, CREDENTIALS_FILE);
  const existing = deps.readJson(path);
  const base = isRecord(existing) ? existing : {};
  const merged = { ...base, claudeAiOauth: toClaudeAiOauthJson(creds) };

  deps.writeFileAtomic(path, JSON.stringify(merged, null, 2));
  deps.chmod600(path);
}

// --- Interno ------------------------------------------------------------------------------------

// Serializa el bloque claudeAiOauth a las claves que el CLI espera (scopes como array mutable para JSON).
function toClaudeAiOauthJson(creds: ClaudeAiOauth): Record<string, unknown> {
  return {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
    scopes: [...creds.scopes],
    subscriptionType: creds.subscriptionType,
    rateLimitTier: creds.rateLimitTier,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
