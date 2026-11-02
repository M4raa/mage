// El perfil aislado de `verify:gui` lee las cuentas REALES del usuario y el detalle de alguna
// comprobación vuelca sus etiquetas (alias y correos). Los informes van a `audit/`, que se queda en el
// disco local (audit/ no se publica): los datos del usuario se enmascaran antes de escribirlos. Misma regla que `collectDomText`.

const MIN_ALIAS_LENGTH = 3;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

export function redactUserData(text, aliases) {
  const sorted = aliases.filter((alias) => alias.length >= MIN_ALIAS_LENGTH).sort((a, b) => b.length - a.length);
  return sorted.reduce((acc, alias) => acc.split(alias).join('<cuenta>'), text).replace(EMAIL_PATTERN, '<correo>');
}
