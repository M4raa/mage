// Extrae del binario de Claude Code el array de verbos del spinner («Accomplishing»…) y genera
// src/renderer/src/workbench/spinnerVerbs.generated.ts. Uso: node scripts/extract-spinner-verbs.mjs
// Binario: MAGE_CLAUDE_BIN, o el instalador nativo (~/.local/bin/claude[.exe]). El array es un literal
// de JS dentro del bundle; no viaja por el stream-json, de ahi el script.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = path.join('src', 'renderer', 'src', 'workbench', 'spinnerVerbs.generated.ts');
const ANCHOR = '"Accomplishing"'; // primer verbo del array (orden alfabetico)
const MIN_VERBS = 100; // por debajo de esto el ancla cayo en otro sitio: mejor fallar

function resolveBinary() {
  if (process.env.MAGE_CLAUDE_BIN) return process.env.MAGE_CLAUDE_BIN;
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const native = path.join(os.homedir(), '.local', 'bin', name);
  if (!fs.existsSync(native)) throw new Error(`No hay binario en ${native}: define MAGE_CLAUDE_BIN`);
  return native;
}

function extractVerbs(source) {
  const anchor = source.indexOf(ANCHOR);
  if (anchor < 0) throw new Error(`No se encontro ${ANCHOR} en el binario`);
  const start = source.lastIndexOf('[', anchor);
  const end = source.indexOf(']', anchor);
  // El literal de JS escapa los no-ASCII como \xE9 (p. ej. «Flambéing»); JSON solo entiende é.
  const literal = source.slice(start, end + 1).replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1');
  const verbs = JSON.parse(literal);
  if (!Array.isArray(verbs) || verbs.length < MIN_VERBS || !verbs.every((v) => typeof v === 'string')) {
    throw new Error(`Array de verbos inesperado: ${JSON.stringify(verbs).slice(0, 80)}`);
  }
  return verbs;
}

const bin = resolveBinary();
const version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
const verbs = extractVerbs(fs.readFileSync(bin).toString('latin1'));
const body = verbs.map((v) => `  ${JSON.stringify(v)},`).join('\n');
fs.writeFileSync(
  OUT,
  `// GENERADO por scripts/extract-spinner-verbs.mjs — no editar a mano.\n` +
    `// Verbos del spinner de Claude Code, extraidos del binario ${version}.\n` +
    `export const CLI_SPINNER_VERBS: readonly string[] = [\n${body}\n];\n`,
);
console.log(`[spinner-verbs] ${verbs.length} verbos de ${version} -> ${OUT}`);
