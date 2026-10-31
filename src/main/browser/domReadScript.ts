// El ÚNICO JavaScript que Mage inyecta en la página para leer el DOM.
// Es fijo: los parámetros entran como datos (`JSON.stringify` y enteros ya validados), nunca como código;
// ningún JS llega de fuera.
import { MAX_NAME_LENGTH, MAX_ROLE_LENGTH, type ResolvedReadDomOptions } from './domSnapshot';

// String.raw para que `\s` llegue intacto a la página. Sin ningún `${` dentro.
const DOM_READ_FUNCTION = String.raw`(selector, maxNodes, maxName, maxRole) => {
  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag !== 'input') return tag;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    return 'textbox';
  };
  const isPassword = (el) => el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'password';
  const nameOf = (el) => {
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const value = isPassword(el) ? '' : (el.value || '');
    const raw = el.getAttribute('aria-label') || label || el.innerText || el.getAttribute('placeholder') || value || el.getAttribute('title') || el.getAttribute('alt') || '';
    return String(raw).replace(/\s+/g, ' ').trim().slice(0, maxName);
  };
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    if (out.length >= maxNodes) break;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const role = (el.getAttribute('role') || implicitRole(el)).slice(0, maxRole);
    out.push({ role, name: nameOf(el), rectDip: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  }
  return out;
}`;

/** Construye la expresión a ejecutar en la página: la función fija llamada con parámetros como datos. */
export function buildDomReadScript(options: ResolvedReadDomOptions): string {
  if (!Number.isInteger(options.maxNodes)) {
    throw new Error(`maxNodes no es entero: ${options.maxNodes}`);
  }
  return `(${DOM_READ_FUNCTION})(${JSON.stringify(options.selector)}, ${options.maxNodes}, ${MAX_NAME_LENGTH}, ${MAX_ROLE_LENGTH})`;
}
