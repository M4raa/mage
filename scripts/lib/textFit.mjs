// F3.6: mide si un texto largo rompe su zona (sobresale, se corta sin elipsis o se monta sobre otro). collectTextFit corre en la página; classifyTextFit es pura y es la que se prueba.

// Un píxel de redondeo de subpíxeles no es un desborde.
export const TEXT_FIT_TOLERANCE_PX = 1;

// Autocontenida: se serializa a la página con page.evaluate, no puede usar nada de fuera de su cuerpo.
export function collectTextFit(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return { root: null, elements: [], siblingPairs: [] };
  const round = (r) => ({ left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) });
  const hasOwnText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '');
  const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const isClipped = (el) => {
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true;
    }
    return false;
  };
  const found = Array.from(root.querySelectorAll('*')).filter((el) => hasOwnText(el) && isVisible(el));
  const elements = found.map((el, id) => {
    const style = getComputedStyle(el);
    return {
      id,
      text: (el.textContent || '').trim().slice(0, 40),
      rect: round(el.getBoundingClientRect()),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      lineClamp: style.webkitLineClamp || 'none',
      clippedByAncestor: isClipped(el),
    };
  });
  const siblingPairs = [];
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      if (found[i].parentElement === found[j].parentElement) siblingPairs.push({ a: i, b: j });
    }
  }
  return { root: round(root.getBoundingClientRect()), elements, siblingPairs };
}

const overlaps = (a, b, tol) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tol;

export function classifyTextFit(measure, tolerancePx = TEXT_FIT_TOLERANCE_PX) {
  if (measure.root === null) return [{ kind: 'sinZona', id: -1, text: '' }];
  const { root, elements, siblingPairs } = measure;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const problems = [];
  for (const e of elements) {
    const out = e.rect.right > root.right + tolerancePx || e.rect.left < root.left - tolerancePx;
    if (out && !e.clippedByAncestor) problems.push({ kind: 'desborde', id: e.id, text: e.text });
    const clips = e.overflowX === 'hidden' || e.overflowX === 'clip';
    if (clips && e.scrollWidth > e.clientWidth + tolerancePx && e.textOverflow !== 'ellipsis' && e.lineClamp === 'none') {
      problems.push({ kind: 'corteSinElipsis', id: e.id, text: e.text });
    }
  }
  for (const { a, b } of siblingPairs) {
    const ea = byId.get(a);
    const eb = byId.get(b);
    if (ea && eb && overlaps(ea.rect, eb.rect, tolerancePx)) problems.push({ kind: 'solape', id: a, text: ea.text, other: eb.text });
  }
  return problems;
}
