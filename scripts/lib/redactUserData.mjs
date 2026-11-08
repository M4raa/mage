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

// Forma corta 8.3 de Windows del usuario (la de `%TEMP%` en algunas máquinas): hasta 6 letras o cifras del nombre, `~` y un número.
const SHORT_NAME_STEM_LENGTH = 6;
function shortNamePattern(user) {
  const stem = user.replace(/[^A-Za-z0-9]/g, '').slice(0, SHORT_NAME_STEM_LENGTH);
  return stem.length === 0 ? null : `${escapeRegExp(stem)}~\\d+`;
}
// Palabra completa: ni letra, ni cifra, ni guion bajo pegados a ella.
const wordPattern = (body) => new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu');

// El HOME y el usuario del sistema de quien ejecuta el harness.
export function localUser() {
  return { home: os.homedir(), user: os.userInfo().username };
}

// Tapa la ruta del HOME, larga y en forma corta 8.3 (con cualquier separador y sin distinguir mayúsculas), y el usuario
// como palabra completa, también en su forma corta.
export function redactLocalUser(text, local = localUser()) {
  const segments = local.home.split(/[\\/]+/).filter((segment) => segment.length > 0).map(escapeRegExp);
  if (segments.length === 0) return redactUserName(text, local.user);
  const short = shortNamePattern(local.user);
  const withoutHome = text.replace(new RegExp(segments.join(PATH_SEPARATOR), 'gi'), '<home>');
  const withoutShortHome = short === null || segments.length < 2 ? withoutHome
    : withoutHome.replace(new RegExp([...segments.slice(0, -1), short].join(PATH_SEPARATOR), 'gi'), '<home>');
  return redactUserName(withoutShortHome, local.user);
}

function redactUserName(text, user) {
  if (user.length < MIN_LOCAL_USER_LENGTH) return text;
  const short = shortNamePattern(user);
  const withoutUser = text.replace(wordPattern(escapeRegExp(user)), '<usuario>');
  return short === null ? withoutUser : withoutUser.replace(wordPattern(short), '<usuario>');
}

export function redactUserData(text, aliases) {
  const sorted = aliases.filter((alias) => alias.length >= MIN_ALIAS_LENGTH).sort((a, b) => b.length - a.length);
  const masked = sorted.reduce((acc, alias) => acc.split(alias).join('<cuenta>'), text).replace(EMAIL_PATTERN, '<correo>');
  return redactLocalUser(masked);
}
