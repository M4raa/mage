// Escribe en `release/NOTES.md` la seccion de CHANGELOG.md de la version de package.json: es el cuerpo
// del release de GitHub (`body_path` en .github/workflows/release.yml) y, de paso, lo que recibe
// electron-updater como `releaseNotes`. Lanza si la seccion falta o esta vacia.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractVersionSection } from './lib/changelog.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const notes = extractVersionSection(fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf-8'), version);
const outFile = path.join(repoRoot, 'release', 'NOTES.md');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${notes}\n`, 'utf-8');
console.log(`[release-notes] ${version}: ${notes.length} caracteres en ${path.relative(repoRoot, outFile)}`);
