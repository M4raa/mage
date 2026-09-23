// Convergencia de credenciales entre una cuenta y su PERFIL PRIVADO (M2.6 / grupo G).
//
// POR QUE EXISTE ESTE MODULO. El perfil privado usa el MISMO login que su cuenta (misma identidad,
// misma facturacion). La primera implementacion compartia el fichero con un HARD LINK, sobre la
// premisa de que el CLI reescribe `.credentials.json` in-place sobre el mismo inode. Esa premisa es
// FALSA y se comprobo en la maquina del usuario (2026-07-31): el CLI persiste con tmp+rename, el
// `rename` sustituye la entrada de directorio y el hard link muere SIN error ni aviso. Medido: el
// file-id del fichero cambio de 0x..240000000d95c7 a 0x..1e00000026eb13 tras una sesion, los dos
// lados quedaron con inodos y contenidos distintos, y el privado arrastraba un token caducado 3 dias.
//
// Por eso ya no se comparte el fichero: se CONVERGE en cada arranque de conversacion privada,
// copiando el lado bueno sobre el otro. En ninguna direccion fija (S2): si es la sesion privada la
// que refresco el token, imponer la direccion cuenta->perfil destruiria un refresh token rotado y
// bueno, dejando la cuenta entera sin login.
//
// POR QUE NO DECIDE POR FECHA. "Gana el LastWriteTime mas reciente" es INSUFICIENTE, y tambien se
// comprobo: cuando el CLI no puede refrescar (refresh token caducado) reescribe el fichero VACIANDO
// el bloque OAuth (accessToken: "", refreshToken: "", expiresAt: 0) y conservando la metadata. Ese
// fichero inservible es el MAS RECIENTE de los dos, asi que un criterio por fecha lo copiaria sobre
// el token bueno y dejaria la cuenta sin login. Se decide por VIGENCIA del token y solo entre lados
// utilizables; la fecha nunca entra en juego.
//
// SEGURIDAD: aqui no viaja ningun token. El lado se describe solo con metadata (existe, mtime,
// expiresAt, si los tokens estan presentes); los valores nunca se leen ni se emiten.

// Estado de un lado (dir de la cuenta o del perfil privado) reducido a lo que decide la convergencia.
// NO incluye el mtime a proposito: la fecha no participa en la decision (ver cabecera), y arrastrar
// metadata que nadie consulta solo invita a volver a decidir por ella.
export interface CredentialsSide {
  readonly path: string;
  readonly exists: boolean;
  readonly expiresAt: number | null; // claudeAiOauth.expiresAt validado (entero > 0); null si no vale
  readonly hasTokens: boolean; // accessToken Y refreshToken presentes y no vacios
}

// Veredicto de la convergencia. `reason` va al log (sin datos sensibles) para que la decision nunca
// sea silenciosa: el fallo original costo lo que costo justamente por ser invisible.
export type ConvergenceDecision =
  | { readonly action: 'none'; readonly reason: string }
  | { readonly action: 'copy'; readonly from: string; readonly to: string; readonly reason: string };

// Un lado sirve para dar login si existe, tiene los dos tokens y un expiresAt valido. Un fichero
// vaciado por el CLI (tokens vacios, expiresAt 0) NO sirve, por reciente que sea.
function isUsable(side: CredentialsSide): boolean {
  return side.exists && side.hasTokens && side.expiresAt !== null;
}

// Decide que lado gana. PURA: ni FS, ni reloj, ni logs.
export function decideCredentialsConvergence(
  account: CredentialsSide,
  profile: CredentialsSide,
): ConvergenceDecision {
  if (account.path === profile.path) {
    throw new Error(`Los dos lados de la convergencia son la misma ruta: ${account.path}`);
  }

  const accountUsable = isUsable(account);
  const profileUsable = isUsable(profile);

  if (!accountUsable && !profileUsable) {
    return { action: 'none', reason: 'ningun lado tiene credenciales utilizables (sin login todavia)' };
  }
  if (accountUsable && !profileUsable) {
    return { action: 'copy', from: account.path, to: profile.path, reason: describeOnlyUsable(profile) };
  }
  if (!accountUsable && profileUsable) {
    return { action: 'copy', from: profile.path, to: account.path, reason: describeOnlyUsable(account) };
  }

  // Ambos utilizables: gana el token vigente mas lejano (el refresh rota hacia expiraciones mayores).
  const accountExpiry = account.expiresAt ?? 0;
  const profileExpiry = profile.expiresAt ?? 0;
  if (accountExpiry === profileExpiry) {
    return { action: 'none', reason: 'ambos lados tienen el mismo token vigente' };
  }
  const accountWins = accountExpiry > profileExpiry;
  return {
    action: 'copy',
    from: accountWins ? account.path : profile.path,
    to: accountWins ? profile.path : account.path,
    reason: `el token de ${accountWins ? 'la cuenta' : 'el perfil privado'} caduca mas tarde`,
  };
}

// Motivo cuando el lado perdedor no sirve: distingue "no existe" de "existe pero esta inservible"
// (el vaciado del CLI), que es informacion util en el log.
function describeOnlyUsable(loser: CredentialsSide): string {
  if (!loser.exists) return `"${loser.path}" no existe`;
  return `"${loser.path}" existe pero no tiene un token utilizable (vaciado o incompleto)`;
}

// --- Frontera de parseo ---------------------------------------------------------------------------

// Metadata del fichero que la capa de FS aporta al parseo (DI: nada de FS aqui dentro).
export interface CredentialsFileMeta {
  readonly path: string;
  readonly exists: boolean;
  readonly json: unknown; // ya leido y parseado; null si no existe / ilegible / JSON invalido
}

// Construye el CredentialsSide validando el JSON externo (nunca se confia en su forma). PURA.
export function parseCredentialsSide(meta: CredentialsFileMeta): CredentialsSide {
  const oauth = readOauthBlock(meta.json);
  return {
    path: meta.path,
    exists: meta.exists,
    expiresAt: readPositiveInteger(oauth?.expiresAt),
    hasTokens: isNonEmptyString(oauth?.accessToken) && isNonEmptyString(oauth?.refreshToken),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOauthBlock(json: unknown): Record<string, unknown> | null {
  if (!isRecord(json) || !isRecord(json.claudeAiOauth)) return null;
  return json.claudeAiOauth;
}

// Entero > 0. Descarta el 0 que escribe el CLI al vaciar el bloque, y cualquier basura no numerica.
function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}
