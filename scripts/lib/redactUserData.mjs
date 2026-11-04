// El perfil aislado de `verify:gui` lee las cuentas REALES del usuario y el detalle de alguna
// comprobación vuelca sus etiquetas (alias y correos). Los informes van a `audit/`, que se queda en el
// disco local (audit/ no se publica): los datos del usuario se enmascaran antes de escribirlos. Misma regla que `collectDomText`.
import os from 'node:os';

const MIN_ALIAS_LENGTH = 3;
const MIN_LOCAL_USER_LENGTH = 3;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// Separador de ruta en cualquiera de sus formas: barra invertida, barra normal y barra invertida doble (la que deja JSON.stringify).
const PATH_SEPARATOR = String.raw`(?:\\\\|\\|/)`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// El HOME y el usuario del sistema de quien ejecuta el harness.
export function localUser() {
  return { home: os.homedir(), user: os.userInfo().username };
}

// Tapa la ruta del HOME (con cualquier separador y sin distinguir mayúsculas) y el usuario como palabra completa.
export function redactLocalUser(text, local = localUser()) {
  const segments = local.home.split(/[\\/]+/).filter((segment) => segment.length > 0).map(escapeRegExp);
  const withoutHome = segments.length === 0 ? text : text.replace(new RegExp(segments.join(PATH_SEPARATOR), 'gi'), '<home>');
  if (local.user.length < MIN_LOCAL_USER_LENGTH) return withoutHome;
  return withoutHome.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(local.user)}(?![\\p{L}\\p{N}_])`, 'giu'), '<usuario>');
}

export function redactUserData(text, aliases) {
  const sorted = aliases.filter((alias) => alias.length >= MIN_ALIAS_LENGTH).sort((a, b) => b.length - a.length);
  const masked = sorted.reduce((acc, alias) => acc.split(alias).join('<cuenta>'), text).replace(EMAIL_PATTERN, '<correo>');
  return redactLocalUser(masked);
}
