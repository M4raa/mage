// Genera `src/shared/i18n/messageKeys.generated.ts` a partir del catálogo base (`catalogs/es.json`): la unión de
// claves (`MessageKey`) y el tipo de las variables de cada mensaje ICU. Así una clave que no existe o una variable
// que falta NO compila (F3.1, INFORME-033 §3).
//   node scripts/i18n-types.mjs           escribe el fichero
//   node scripts/i18n-types.mjs --check   falla si el fichero no está al día, si las claves de es.json no están
//                                         ordenadas o si algún catálogo tiene claves que es.json no tiene
// Lo ejecuta `pnpm check` con --check (DEVOLUCION-018: los tipos generados se comprueban).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMessageArgs } from './lib/icuArgs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogsDir = join(root, 'src', 'shared', 'i18n', 'catalogs');
const outFile = join(root, 'src', 'shared', 'i18n', 'messageKeys.generated.ts');
const BASE = 'es';
const OTHERS = ['en'];

// Tipo TS de cada clase de argumento ICU.
const TS_TYPE = { simple: 'string | number', number: 'number', string: 'string', date: 'Date | number' };

const readCatalog = (locale) => {
  const path = join(catalogsDir, `${locale}.json`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${path} no es un objeto {clave: mensaje}`);
  for (const [key, message] of Object.entries(parsed)) {
    if (typeof message !== 'string') throw new Error(`${path}: el mensaje de ${JSON.stringify(key)} no es texto: ${JSON.stringify(message)}`);
  }
  return parsed;
};

function valuesType(message, key) {
  const args = extractMessageArgs(message, key);
  if (args.size === 0) return 'never';
  const fields = [...args].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, kind]) => `readonly ${JSON.stringify(name)}: ${TS_TYPE[kind]}`);
  return `{ ${fields.join('; ')} }`;
}

function render(catalog) {
  const lines = Object.keys(catalog).map((key) => `  readonly ${JSON.stringify(key)}: ${valuesType(catalog[key], key)};`);
  return [
    '// GENERADO por scripts/i18n-types.mjs a partir de catalogs/es.json. No se edita a mano: `pnpm i18n:types`.',
    '// `never` = el mensaje no tiene variables.',
    'export interface MessageValues {',
    ...lines,
    '}',
    '',
    'export type MessageKey = keyof MessageValues;',
    '',
    '// Argumentos de `t(key, ...)`: nada si el mensaje no tiene variables; si las tiene, el objeto es obligatorio.',
    'export type MessageArgs<K extends MessageKey> = [MessageValues[K]] extends [never] ? [] : [values: MessageValues[K]];',
    '',
  ].join('\n');
}

function problemsOf(base) {
  const keys = Object.keys(base);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b, 'en'));
  const problems = keys.join('\n') === sorted.join('\n') ? [] : [`las claves de ${BASE}.json no están ordenadas`];
  // @lingui/core decodifica \xHH y \uHHHH en el texto final: un mensaje con esas secuencias no saldría como se escribió.
  for (const locale of [BASE, ...OTHERS]) {
    const escaped = Object.entries(readCatalog(locale)).filter(([, message]) => /\\(u[0-9a-f]{4}|x[0-9a-f]{2})/i.test(message)).map(([key]) => key);
    if (escaped.length > 0) problems.push(`${locale}.json tiene secuencias \\x o \\u que Lingui decodificaría: ${escaped.join(', ')}`);
  }
  for (const locale of OTHERS) {
    const extra = Object.keys(readCatalog(locale)).filter((key) => !(key in base));
    if (extra.length > 0) problems.push(`${locale}.json tiene claves que ${BASE}.json no tiene: ${extra.join(', ')}`);
  }
  return problems;
}

const base = readCatalog(BASE);
const generated = render(base);
if (process.argv.includes('--check')) {
  const current = (() => { try { return readFileSync(outFile, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; } })();
  const problems = problemsOf(base);
  if (current !== generated) problems.push('messageKeys.generated.ts no está al día con es.json (ejecuta `pnpm i18n:types`)');
  if (problems.length > 0) {
    console.error(`[i18n] ${problems.join('\n[i18n] ')}`);
    process.exit(1);
  }
  console.log(`[i18n] tipos al día: ${Object.keys(base).length} claves`);
} else {
  writeFileSync(outFile, generated);
  console.log(`[i18n] ${outFile}: ${Object.keys(base).length} claves`);
}
