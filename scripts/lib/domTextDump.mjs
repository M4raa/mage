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
export const EXCLUDED_SUBTREES = ['[data-history-session]', '[data-recent-project]', '[data-usage-popover]', '[data-usage-account]'];

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
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{7,}\b/gi, '<hex>')
    .replace(/\d+([.,:]\d+)*/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

function linesOf(entry) {
  return [...entry.text.split('\n'), ...entry.attrs].map(normalizeDomLine).filter((line) => line.length > 0);
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

// Diferencias por comprobación: líneas que solo están en una de las dos tandas (multiconjunto, ignora el orden).
export function diffDumps(before, after) {
  const differences = [];
  for (const [name, entry] of before) {
    const other = after.get(name);
    if (other === undefined) { differences.push({ name, missing: 'after' }); continue; }
    const counts = new Map();
    for (const line of linesOf(entry)) counts.set(line, (counts.get(line) ?? 0) + 1);
    for (const line of linesOf(other)) counts.set(line, (counts.get(line) ?? 0) - 1);
    const onlyBefore = [...counts].filter(([, n]) => n > 0).map(([line]) => line);
    const onlyAfter = [...counts].filter(([, n]) => n < 0).map(([line]) => line);
    if (onlyBefore.length > 0 || onlyAfter.length > 0) differences.push({ name, onlyBefore, onlyAfter });
  }
  for (const name of after.keys()) if (!before.has(name)) differences.push({ name, missing: 'before' });
  return differences;
}
