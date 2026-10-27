// Argumentos de un mensaje ICU MessageFormat y su clase, para tipar `t(key, values)` (scripts/i18n-types.mjs).
// No es un parser ICU completo: reconoce `{nombre}`, `{nombre, tipo}`, `{nombre, tipo, estilo}` y las opciones de
// plural/select/selectordinal (recursivas), con el apóstrofo de ICU para escapar llaves. Un mensaje mal formado
// lanza con la clave y la posición; el compilador de Lingui lo revalida al construir.

const KIND_BY_TYPE = { plural: 'number', selectordinal: 'number', number: 'number', select: 'string', date: 'date', time: 'date' };
const BRANCHING = new Set(['plural', 'selectordinal', 'select']);

// Índice tras un tramo entre apóstrofos que empieza en `i` ('' es un apóstrofo literal).
function skipQuoted(msg, i) {
  if (msg[i + 1] === "'") return i + 2;
  if (!['{', '}', '#', '|'].includes(msg[i + 1])) return i + 1;
  const end = msg.indexOf("'", i + 1);
  return end === -1 ? msg.length : end + 1;
}

// Índice de la `}` que cierra la `{` abierta justo antes de `start`.
function matchingBrace(msg, start, where) {
  let depth = 1;
  for (let i = start; i < msg.length; ) {
    if (msg[i] === "'") { i = skipQuoted(msg, i); continue; }
    if (msg[i] === '{') depth += 1;
    if (msg[i] === '}' && --depth === 0) return i;
    i += 1;
  }
  throw new Error(`Mensaje ICU mal formado en ${where}: falta una «}» desde la posición ${start}`);
}

function record(out, name, kind, where) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Variable ICU no válida en ${where}: ${JSON.stringify(name)}`);
  const previous = out.get(name);
  if (previous !== undefined && previous !== kind && previous !== 'simple' && kind !== 'simple') {
    throw new Error(`La variable ${name} de ${where} se usa como ${previous} y como ${kind}`);
  }
  if (previous === undefined || previous === 'simple') out.set(name, kind);
}

// Recorre las opciones `clave {submensaje}` de un plural/select y escanea cada submensaje.
function scanOptions(body, out, where) {
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const close = matchingBrace(body, open + 1, where);
    scan(body.slice(open + 1, close), out, where);
    i = close + 1;
  }
}

// Un argumento que empieza en `start` (justo tras su `{`). Devuelve el índice tras su `}`.
function scanArg(msg, start, out, where) {
  const end = matchingBrace(msg, start, where);
  const parts = msg.slice(start, end).split(',');
  const name = parts[0].trim();
  const type = (parts[1] ?? '').trim();
  if (type.length === 0) { record(out, name, 'simple', where); return end + 1; }
  const kind = KIND_BY_TYPE[type];
  if (kind === undefined) throw new Error(`Tipo ICU desconocido en ${where}: ${JSON.stringify(type)}`);
  record(out, name, kind, where);
  if (BRANCHING.has(type)) scanOptions(parts.slice(2).join(','), out, where);
  return end + 1;
}

function scan(msg, out, where) {
  for (let i = 0; i < msg.length; ) {
    if (msg[i] === "'") { i = skipQuoted(msg, i); continue; }
    if (msg[i] === '}') throw new Error(`Mensaje ICU mal formado en ${where}: «}» sin abrir en la posición ${i}`);
    i = msg[i] === '{' ? scanArg(msg, i + 1, out, where) : i + 1;
  }
}

// Map nombre -> clase ('simple' | 'number' | 'string' | 'date').
export function extractMessageArgs(message, where = 'mensaje') {
  const out = new Map();
  scan(message, out, where);
  return out;
}
