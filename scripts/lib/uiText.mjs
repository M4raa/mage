import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Textos de la interfaz que buscan las comprobaciones de verify:gui, tomados del catálogo por CLAVE y en el idioma de
// la tanda (`--lang=es|en`). Así una comprobación no depende de que la interfaz esté en castellano.
const loadCatalog = (lang) => JSON.parse(readFileSync(new URL(`../../src/shared/i18n/catalogs/${lang}.json`, import.meta.url), 'utf8'));

export const UI_LANGUAGES = ['es', 'en'];
const CATALOGS = { es: loadCatalog('es'), en: loadCatalog('en') };
const ICU_FORMAT = /\{\s*\w+\s*,/;
const VARIABLE = /\{(\w+)\}/g;

function assertUiLanguage(value) {
  if (!UI_LANGUAGES.includes(value)) throw new Error(`--lang no válido: ${JSON.stringify(value)} (${UI_LANGUAGES.join(' | ')})`);
}

// `--lang=` de la línea de comandos; ausente → null (el idioma del sistema, textos esperados en castellano).
export function parseUiLangArg(argv) {
  const arg = argv.find((a) => a.startsWith('--lang='));
  if (arg === undefined) return null;
  const value = arg.slice('--lang='.length);
  assertUiLanguage(value);
  return value;
}

let activeLanguage = parseUiLangArg(process.argv) ?? 'es';

export const getUiLanguage = () => activeLanguage;

export function setUiLanguage(lang) {
  assertUiLanguage(lang);
  activeLanguage = lang;
}

function messageOf(lang, key) {
  const message = CATALOGS[lang]?.[key];
  if (typeof message !== 'string') throw new Error(`Clave de catálogo desconocida: ${key} (${lang})`);
  return message;
}

// Mensaje de un catálogo con sus `{variables}` sustituidas. Plural/select no se formatean: se compara con `uiPrefix`.
export function uiIn(lang, key, vars = {}) {
  const message = messageOf(lang, key);
  if (ICU_FORMAT.test(message)) throw new Error(`ui() no formatea plural/select: ${key}`);
  return message.replace(VARIABLE, (_, name) => {
    if (!(name in vars)) throw new Error(`Falta la variable ${name} de ${key}`);
    return String(vars[name]);
  });
}

export const ui = (key, vars) => uiIn(getUiLanguage(), key, vars);

// Texto del mensaje hasta su primera variable: lo que se ve siempre, valga lo que valga la variable.
export function uiPrefix(key) {
  const message = messageOf(getUiLanguage(), key);
  const brace = message.indexOf('{');
  return (brace === -1 ? message : message.slice(0, brace)).trimEnd();
}

// Tramos fijos de un mensaje (el texto entre variables), sin `trim()` y en orden. Corta en cada `{` de primer nivel y en
// su `}` de cierre, así que un plural/select entero cuenta como una sola variable.
export function messageSegments(message) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (const char of message) {
    if (char === '{') {
      if (depth === 0) {
        segments.push(current);
        current = '';
      }
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
    } else if (depth === 0) {
      current += char;
    }
  }
  segments.push(current);
  return segments;
}

// Tramo fijo nº `index` (desde 0) del mensaje en el idioma activo, con `trim()`. Solo vale si es y en trocean igual.
export function uiSegment(key, index) {
  const lang = getUiLanguage();
  const esCount = messageSegments(messageOf('es', key)).length;
  const enCount = messageSegments(messageOf('en', key)).length;
  if (esCount !== enCount) throw new Error(`uiSegment: ${key} tiene ${esCount} tramos en es y ${enCount} en en`);
  const segments = messageSegments(messageOf(lang, key));
  if (!Number.isInteger(index) || index < 0 || index >= segments.length) {
    throw new Error(`uiSegment: ${key} no tiene el tramo ${index} (${segments.length} tramos, ${lang})`);
  }
  return segments[index].trim();
}

export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const uiRegExp = (key, flags = '') => new RegExp(escapeRegExp(ui(key)), flags);

// Para meter un texto dentro de `"…"` en un selector de atributo.
export const cssAttr = (text) => text.replace(/["\\]/g, '\\$&');

// Mensajes plural/select del catálogo formateados con la MISMA biblioteca que la app (Lingui), en el idioma de la tanda.
// `@lingui/message-utils` no cuelga de node_modules/@lingui: se resuelve desde `@lingui/vite-plugin`.
const repoRequire = createRequire(new URL('../../package.json', import.meta.url));
const linguiRequire = createRequire(repoRequire.resolve('@lingui/vite-plugin'));
const { compileMessage } = linguiRequire('@lingui/message-utils/compileMessage');
const { setupI18n } = repoRequire('@lingui/core');

export function uiPluralIn(lang, key, vars) {
  const message = messageOf(lang, key);
  if (vars === null || typeof vars !== 'object') throw new Error(`uiPlural(${key}) necesita sus variables: ${JSON.stringify(vars)}`);
  const i18n = setupI18n({ locale: lang, messages: { [lang]: { [key]: compileMessage(message) } } });
  return i18n._(key, vars);
}

export const uiPlural = (key, vars) => uiPluralIn(getUiLanguage(), key, vars);
