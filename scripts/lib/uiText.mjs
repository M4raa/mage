import { readFileSync } from 'node:fs';

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

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const uiRegExp = (key, flags = '') => new RegExp(escapeRegExp(ui(key)), flags);

// Para meter un texto dentro de `"…"` en un selector de atributo.
export const cssAttr = (text) => text.replace(/["\\]/g, '\\$&');
