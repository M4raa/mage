// T4 de DEVOLUCION-018: volcado del texto del DOM por comprobación de `verify:gui`, SOLO durante F3 y solo con la
// opción explícita `--dump-dom-text=<fichero.jsonl>`. No es una comprobación permanente: daría falsos fallos con cada
// cambio de texto intencionado. Sirve para el criterio de F3.2: el texto en «es» es idéntico antes y después de
// extraer las claves. Se compara con `node scripts/compare-dom-text.mjs antes.jsonl despues.jsonl`.

import fs from 'node:fs';

// Atributos que la extracción también mueve al catálogo (los visibles y los de accesibilidad).
export const DUMPED_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-valuetext', 'data-tip'];

// Datos que vienen de las cuentas REALES del usuario (el perfil del harness es aislado, pero el historial y el uso se
// leen de sus cuentas): títulos y tamaños de sus conversaciones, sus carpetas recientes y su uso. No son textos de
// Mage, cambian entre tandas y NO se guardan en el volcado.
// Y todo nodo marcado con data-volatile-text: texto de Mage cuyo valor sale del uso, del historial o del entorno reales
// (la barra de estado, el panel Uso, la ruta de agy, el vacío y «Mostrar N más» de la barra lateral). Límite conocido:
// esos textos no se comparan en F3.2.
export const EXCLUDED_SUBTREES = ['[data-history-session]', '[data-recent-projects]', '[data-usage-popover]', '[data-usage-account]', '[data-volatile-text]'];

// Se ejecuta EN la página: cada texto visible (un nodo de texto por línea, en orden del documento) y los atributos
// traducibles, saltando los subárboles excluidos. Los alias de las cuentas y cualquier correo se sustituyen por una
// marca ANTES de salir de la página: son datos del usuario, no textos de Mage.
export function collectDomText({ attributes, excluded }) {
  const skip = (element) => excluded.some((selector) => element.closest(selector) !== null);
  const aliases = (window.__mageDev?.store.getState().accounts ?? []).map((a) => a.alias).filter((a) => a.length > 2).sort((a, b) => b.length - a.length);
  const redact = (text) => aliases.reduce((acc, alias) => acc.split(alias).join('<cuenta>'), text).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<correo>');
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = (node.textContent ?? '').trim();
    if (parent === null || text.length === 0 || skip(parent) || !parent.checkVisibility()) continue;
    if (parent.closest('script, style') !== null) continue;
    lines.push(redact(text));
  }
  const attrs = [];
  for (const element of document.querySelectorAll('*')) {
    if (skip(element)) continue;
    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (value !== null && value.trim().length > 0) attrs.push(`${name}=${redact(value.trim())}`);
    }
  }
  return { text: lines.join('\n'), attrs };
}

export async function appendDomText(page, file, name) {
  const dump = await page.evaluate(collectDomText, { attributes: DUMPED_ATTRIBUTES, excluded: EXCLUDED_SUBTREES });
  fs.appendFileSync(file, JSON.stringify({ name, ...dump }) + '\n');
}

// Lo que cambia entre dos tandas SIN que cambie ningún texto: relojes, duraciones, contadores, ids y rutas temporales.
// Se normaliza antes de comparar: un número distinto no es una frase distinta.
export function normalizeDomLine(line) {
  return line
    .replace(/[A-Za-z]:\\[^\s"'«»]+/g, '<ruta>')
    .replace(/\/(?:home|Users|tmp|mnt)\/[^\s"'«»]+/g, '<ruta>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{7,}\b/gi, '<hex>')
    .replace(/\d+([.,:]\d+)*/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

const normalizedLines = (lines) => lines.map(normalizeDomLine).filter((line) => line.length > 0);
const linesOf = (entry) => normalizedLines([...entry.text.split('\n'), ...entry.attrs]);
const attrsOf = (entry) => normalizedLines(entry.attrs);

// Texto visible de un caso unido en una sola cadena sin espacios: el criterio de F3.2 es que el texto sea el mismo
// aunque la extracción lo reparta en otros nodos (un contador que pasa de nodo propio a ir dentro de la frase). Los
// atributos NO entran: se comparan aparte con `diffAttrs`.
export function joinedTextOf(entry) {
  return normalizedLines(entry.text.split('\n')).join('').replace(/\s+/g, '');
}

export function readDump(file) {
  const byName = new Map();
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    if (raw.trim().length === 0) continue;
    const entry = JSON.parse(raw);
    byName.set(entry.name, entry);
  }
  return byName;
}

// Recorre los casos de las dos tandas: los que faltan en un lado se marcan y los comunes pasan por `compare`, que
// devuelve la diferencia (sin `name`) o `null` si son iguales.
function diffByName(before, after, compare) {
  const differences = [];
  for (const [name, entry] of before) {
    const other = after.get(name);
    if (other === undefined) { differences.push({ name, missing: 'after' }); continue; }
    const difference = compare(entry, other);
    if (difference !== null) differences.push({ name, ...difference });
  }
  for (const name of after.keys()) if (!before.has(name)) differences.push({ name, missing: 'before' });
  return differences;
}

// Líneas que solo están en una de las dos tandas (multiconjunto, ignora el orden).
function diffLines(linesA, linesB) {
  const counts = new Map();
  for (const line of linesA) counts.set(line, (counts.get(line) ?? 0) + 1);
  for (const line of linesB) counts.set(line, (counts.get(line) ?? 0) - 1);
  const onlyBefore = [...counts].filter(([, n]) => n > 0).map(([line]) => line);
  const onlyAfter = [...counts].filter(([, n]) => n < 0).map(([line]) => line);
  return onlyBefore.length === 0 && onlyAfter.length === 0 ? null : { onlyBefore, onlyAfter };
}

// Diferencias por comprobación, por líneas de texto y atributos juntos.
export function diffDumps(before, after) {
  return diffByName(before, after, (a, b) => diffLines(linesOf(a), linesOf(b)));
}

// Diferencias por comprobación SOLO en los atributos (el texto va por `diffJoined`).
export function diffAttrs(before, after) {
  return diffByName(before, after, (a, b) => diffLines(attrsOf(a), attrsOf(b)));
}

// Fragmento de cada lado alrededor de la primera posición que difiere (como en la sonda de INFORME-037).
const FRAGMENT_BEFORE_CHARS = 60;
const FRAGMENT_AFTER_CHARS = 80;
function fragmentsAroundFirstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - FRAGMENT_BEFORE_CHARS);
  return { before: a.slice(start, i + FRAGMENT_AFTER_CHARS), after: b.slice(start, i + FRAGMENT_AFTER_CHARS) };
}

// Diferencias por comprobación en el texto unido (`joinedTextOf`): { name, before, after } con los fragmentos.
export function diffJoined(before, after) {
  return diffByName(before, after, (a, b) => {
    const x = joinedTextOf(a);
    const y = joinedTextOf(b);
    return x === y ? null : fragmentsAroundFirstDifference(x, y);
  });
}

// Separa las diferencias de los casos cuyo nombre está en `noiseNames` (ruido medido entre dos tandas del mismo
// commit, o lista --ignore aceptada). Un caso descartado NO se compara: toda su diferencia se aparta.
export function partitionNoise(differences, noiseNames) {
  const names = new Set(noiseNames);
  const kept = differences.filter((d) => !names.has(d.name));
  const noise = differences.filter((d) => names.has(d.name));
  return { kept, noise };
}

// Valida una lista --ignore: cada entrada lleva el nombre del caso y un motivo no vacío.
export function readIgnoreList(entries) {
  if (!Array.isArray(entries)) throw new Error(`lista --ignore no valida: se esperaba una lista, llegó ${JSON.stringify(entries)}`);
  for (const entry of entries) {
    if (typeof entry?.name !== 'string' || entry.name.length === 0) throw new Error(`entrada --ignore sin name: ${JSON.stringify(entry)}`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) throw new Error(`entrada --ignore sin reason: ${entry.name}`);
  }
  return entries;
}
