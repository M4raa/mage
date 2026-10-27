// Inventario medido de los textos visibles de Mage, para el diseño de F3 (internacionalización). Recorre el AST de
// TypeScript de src/ (sin tests) y clasifica cada texto por zona según dónde aparece: JSX, menús, diálogos,
// notificaciones, errores, textos de main que viajan al renderer… Los logs y las instrucciones al modelo se cuentan
// aparte porque NO se traducen (regla 6 de F3). Es un conteo heurístico: el informe declara el método y sus límites.
//
// Uso: node spike/i18n-inventory.mjs <carpeta de salida>   → resumen.json, textos.tsv y por-fichero.tsv
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const outDir = process.argv[2];
if (!outDir) throw new Error('Falta la carpeta de salida: node spike/i18n-inventory.mjs <carpeta>');

const VISIBLE_JSX_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'aria-description', 'aria-valuetext', 'label']);
const NON_TEXT_JSX_ATTRS = new Set(['className', 'class', 'style', 'id', 'key', 'href', 'src', 'role', 'type', 'name', 'data-testid', 'htmlFor']);
const LABEL_KEYS = new Set(['label', 'title', 'description', 'placeholder', 'message', 'text', 'hint', 'detail', 'body', 'buttons', 'tooltip', 'emptyText', 'subtitle', 'heading', 'summary', 'reason']);
const LOG_CALLEE = /(^|\.)(log|mainLog|logger|debug|info|warn|trace|console\.\w+)$|^console\./;
const CLASS_HELPERS = /^(cn|clsx|cx|twMerge|classNames)$/;
const MODEL_INSTRUCTION_FILES = [/^main[\\/]runtime[\\/](systemPrompt|compaction)\.ts$/, /^main[\\/]instructions[\\/]/, /^main[\\/]prompt[\\/]/, /^main[\\/]runtime[\\/]tools[\\/]/];
// Catálogos de nombres de producto (navegadores, editores): no se traducen.
const PRODUCT_NAME_FILES = [/^main[\\/]os[\\/]openTargets\.ts$/];
const ES_WORDS = new Set('de la el que no en los las un una para con por se del al es ya sin esta este hay más tu tus su sus lo le como o y si'.split(' '));
const EN_WORDS = new Set('the to of and is you a in for not with this that be are it on or your can no'.split(' '));

function listSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__' || entry.name === 'testing') continue;
      out.push(...listSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|audit\.test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Texto de un literal; las interpolaciones de una plantilla cuentan como variables ({0}, {1}…).
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, vars: 0 };
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    node.templateSpans.forEach((span, i) => { text += `{${i}}` + span.literal.text; });
    return { text, vars: node.templateSpans.length };
  }
  return null;
}

function looksLikeText(text, viaLabelKey) {
  const t = text.trim();
  if (!/\p{L}/u.test(t)) return false;
  if (/^(CREATE|SELECT|INSERT|UPDATE|DELETE|PRAGMA|ALTER)\s/.test(t)) return false; // SQL
  if (/:\/\/|^\.{0,2}\/|\\|^[#.@]?[\w-]+:[\w-]+$|^[A-Z0-9_]+$|^[\w.-]+\.(ts|tsx|js|json|md|png|svg|css|exe|lock)$/.test(t)) return false;
  const tokens = t.split(/\s+/);
  if (tokens.every((tok) => /^[a-z0-9\-:/[\]%!#_.()&>~+=,'"{}]+$/.test(tok)) && tokens.some((tok) => /[-:[]/.test(tok))) return false; // clases CSS
  if (/[áéíóúñ¿¡ü]/i.test(t)) return true;
  if (tokens.filter((tok) => /\p{L}{2,}/u.test(tok)).length >= 2) return true;
  return viaLabelKey && /^\p{Lu}/u.test(t);
}

function language(text) {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es';
  const es = words.filter((w) => ES_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  if (es > en) return 'es';
  if (en > es) return 'en';
  return '?';
}

function calleeName(call) {
  const e = call.expression;
  return ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) ? e.getText() : '';
}

// Contexto que excluye el literal (no es texto) o lo asigna a una zona. Sube por los padres hasta la sentencia.
function context(node, area, relFile) {
  let viaLabelKey = false;
  let zone = null;
  for (let p = node.parent, child = node; p; child = p, p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p) && child === p.expression) return { skip: true };
    if (ts.isBinaryExpression(p) && /^(===|!==|==|!=|in)$/.test(p.operatorToken.getText())) return { skip: true };
    if (ts.isElementAccessExpression(p) && child === p.argumentExpression) return { skip: true };
    if (ts.isPropertyAssignment(p) && child === p.name) return { skip: true };
    if (ts.isPropertyAssignment(p) && !zone) {
      const key = p.name.getText().replace(/['"]/g, '');
      if (key === 'className' || key === 'style' || key === 'channel') return { skip: true };
      if (LABEL_KEYS.has(key)) viaLabelKey = true;
      if (key === 'label' && relFile === join('main', 'index.ts')) zone ??= 'main · menús nativos (bandeja)';
    }
    if (ts.isJsxAttribute(p)) {
      const attr = p.name.getText();
      if (NON_TEXT_JSX_ATTRS.has(attr)) return { skip: true };
      if (VISIBLE_JSX_ATTRS.has(attr)) { viaLabelKey = true; zone ??= 'renderer · JSX (atributos visibles)'; }
    }
    if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText())) zone ??= `${area} · errores (new Error)`;
    if (ts.isCallExpression(p)) {
      const name = calleeName(p);
      if (CLASS_HELPERS.test(name)) return { skip: true };
      // Canales IPC, eventos, selectores y módulos: solo el literal pasado DIRECTAMENTE como argumento; el cuerpo de un
      // callback (`handle(canal, () => { throw new Error('…') })`) sí se cuenta.
      const directArg = child === node && p.arguments.includes(node);
      if (directArg && (name === 'require' || /^(ipcRenderer|ipcMain)\./.test(name) || /\.(handle|on|once|off|send|invoke|emit|querySelector|querySelectorAll|getAttribute|setAttribute|addEventListener|removeEventListener|getItem|setItem)$/.test(name))) return { skip: true };
      if (LOG_CALLEE.test(name)) return { zone: 'excluido · logs', viaLabelKey };
      if (/^dialog\./.test(name)) zone ??= 'main · diálogos nativos';
    }
    if (ts.isThrowStatement(p)) zone ??= `${area} · errores (new Error)`;
    if (ts.isSourceFile(p)) break;
  }
  if (MODEL_INSTRUCTION_FILES.some((re) => re.test(relFile))) return { zone: 'excluido · instrucciones al modelo', viaLabelKey };
  if (PRODUCT_NAME_FILES.some((re) => re.test(relFile))) return { zone: 'excluido · nombres de producto', viaLabelKey };
  if (!zone && area === 'main' && /^main[\\/]notifications[\\/]/.test(relFile)) zone = 'main · notificaciones del sistema';
  zone ??= area === 'renderer' ? 'renderer · cadenas en código (stores, avisos, catálogos)'
    : area === 'main' ? 'main · textos que viajan al renderer (eventos, estados, avisos)'
    : `${area} · cadenas compartidas`;
  return { zone, viaLabelKey };
}

function areaOf(relFile) {
  return relFile.split(sep)[0].split('/')[0];
}

function scanFile(file, rows) {
  const relFile = relative(SRC, file);
  const area = areaOf(relFile);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (node, text, vars, zone) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    rows.push({ file: relFile.split(sep).join('/'), line: line + 1, zone, vars, lang: language(text), text: text.trim().replace(/\s+/g, ' ') });
  };
  const visit = (node) => {
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && node.children.some((c) => ts.isJsxText(c) && /\p{L}/u.test(c.getText()))) jsxMessages.count++;
    if (ts.isJsxText(node)) {
      const text = node.getText().trim();
      if (/\p{L}/u.test(text)) add(node, text, 0, 'renderer · JSX (texto)');
      return;
    }
    const lit = literalText(node);
    if (lit) {
      const ctx = context(node, area, relFile);
      if (!ctx.skip && looksLikeText(lit.text, ctx.viaLabelKey)) add(node, lit.text, lit.vars, ctx.zone);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function summarize(rows) {
  const zones = new Map();
  for (const r of rows) {
    const z = zones.get(r.zone) ?? { textos: 0, unicos: new Set(), palabras: 0, conVariables: 0, es: 0, en: 0, dudoso: 0, ficheros: new Set() };
    z.textos++;
    z.unicos.add(r.text);
    z.palabras += (r.text.match(/\p{L}+/gu) ?? []).length;
    if (r.vars > 0) z.conVariables++;
    z[r.lang === '?' ? 'dudoso' : r.lang]++;
    z.ficheros.add(r.file);
    zones.set(r.zone, z);
  }
  return [...zones].sort(([a], [b]) => a.localeCompare(b)).map(([zona, z]) => ({ zona, textos: z.textos, unicos: z.unicos.size, palabras: z.palabras, conVariables: z.conVariables, es: z.es, en: z.en, dudoso: z.dudoso, ficheros: z.ficheros.size }));
}

const jsxMessages = { count: 0 };
const files = listSources(SRC);
const rows = [];
for (const f of files) scanFile(f, rows);
mkdirSync(outDir, { recursive: true });
const resumen = { generado: new Date().toISOString(), ficherosAnalizados: files.length, mensajesJsx: jsxMessages.count, zonas: summarize(rows) };
writeFileSync(join(outDir, 'resumen.json'), JSON.stringify(resumen, null, 2));
writeFileSync(join(outDir, 'textos.tsv'), ['fichero\tlinea\tzona\tidioma\tvariables\ttexto', ...rows.map((r) => [r.file, r.line, r.zone, r.lang, r.vars, r.text].join('\t'))].join('\n'));
const perFile = new Map();
for (const r of rows) if (!r.zone.startsWith('excluido')) perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1);
writeFileSync(join(outDir, 'por-fichero.tsv'), ['fichero\ttextos', ...[...perFile].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}\t${n}`)].join('\n'));
console.log(JSON.stringify(resumen, null, 2));
