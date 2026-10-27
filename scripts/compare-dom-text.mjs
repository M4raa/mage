// Compara dos volcados de `verify:gui --dump-dom-text` (T4 de DEVOLUCION-018, criterio de F3.2): el texto del DOM en
// «es» tiene que ser idéntico antes y después de extraer las claves.
//   node scripts/compare-dom-text.mjs antes.jsonl despues.jsonl [--ignore=ruido.json]
// `--ignore`: diferencias que ya salen entre dos tandas del MISMO commit (ruido medido), con la forma que imprime esta
// herramienta con `--json`. Sale con 1 si queda alguna diferencia.
import fs from 'node:fs';
import { diffDumps, readDump } from './lib/domTextDump.mjs';

const [beforeFile, afterFile] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (beforeFile === undefined || afterFile === undefined) throw new Error('Uso: node scripts/compare-dom-text.mjs antes.jsonl despues.jsonl [--ignore=ruido.json] [--json]');
const ignoreFile = process.argv.find((arg) => arg.startsWith('--ignore='))?.slice('--ignore='.length);
const ignored = ignoreFile === undefined ? [] : JSON.parse(fs.readFileSync(ignoreFile, 'utf8'));
const ignoredLines = new Map(ignored.map((d) => [d.name, new Set([...(d.onlyBefore ?? []), ...(d.onlyAfter ?? [])])]));

const differences = diffDumps(readDump(beforeFile), readDump(afterFile))
  .map((d) => {
    const noise = ignoredLines.get(d.name);
    if (noise === undefined || d.missing !== undefined) return d;
    return { ...d, onlyBefore: d.onlyBefore.filter((l) => !noise.has(l)), onlyAfter: d.onlyAfter.filter((l) => !noise.has(l)) };
  })
  .filter((d) => d.missing !== undefined || d.onlyBefore.length > 0 || d.onlyAfter.length > 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(differences, null, 1));
} else {
  for (const d of differences) {
    console.log(`\n## ${d.name}`);
    if (d.missing !== undefined) { console.log(`  falta en ${d.missing === 'after' ? 'después' : 'antes'}`); continue; }
    for (const line of d.onlyBefore) console.log(`  - ${line}`);
    for (const line of d.onlyAfter) console.log(`  + ${line}`);
  }
  console.log(`\n[dom-text] ${differences.length} comprobaciones con diferencias`);
}
process.exit(differences.length === 0 ? 0 : 1);
