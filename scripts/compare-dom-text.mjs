// Compara dos volcados de `verify:gui --dump-dom-text` (criterio de F3.2): el texto del DOM en
// «es» tiene que ser idéntico antes y después de extraer las claves.
//   node scripts/compare-dom-text.mjs antes.jsonl despues.jsonl [--ref2=segunda-referencia.jsonl] [--ignore=ruido.json] [--json]
// Por caso compara el TEXTO UNIDO (sin espacios: el reparto en nodos no cuenta) y los atributos aparte.
// `--ref2`: una segunda tanda del MISMO commit que `antes`; los casos que ya difieren entre antes y ref2 son ruido
// medido y se descartan enteros. `--ignore`: lista JSON de { name, reason } aceptada por dirección (reason obligatorio).
// Límite conocido: un caso descartado por ruido o por --ignore NO se compara en absoluto. Sale con 1 si queda alguna
// diferencia sin descartar.
import fs from 'node:fs';
import { diffAttrs, diffJoined, partitionNoise, readDump, readIgnoreList } from './lib/domTextDump.mjs';

const USAGE = 'Uso: node scripts/compare-dom-text.mjs antes.jsonl despues.jsonl [--ref2=ref.jsonl] [--ignore=ruido.json] [--json]';
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const [beforeFile, afterFile] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (beforeFile === undefined || afterFile === undefined) throw new Error(USAGE);

// Texto unido y atributos; los casos ausentes ya los marca diffJoined, así que de diffAttrs solo entran los presentes.
const differencesOf = (a, b) => [...diffJoined(a, b), ...diffAttrs(a, b).filter((d) => d.missing === undefined)];
const uniqueNames = (differences) => [...new Set(differences.map((d) => d.name))];

const before = readDump(beforeFile);
const ref2File = option('ref2');
const noiseNames = ref2File === undefined ? [] : uniqueNames(differencesOf(before, readDump(ref2File)));
const ignoreFile = option('ignore');
const ignoreList = ignoreFile === undefined ? [] : readIgnoreList(JSON.parse(fs.readFileSync(ignoreFile, 'utf8')));

const all = differencesOf(before, readDump(afterFile));
const byNoise = partitionNoise(all, noiseNames);
const byIgnore = partitionNoise(byNoise.kept, ignoreList.map((e) => e.name));
const differences = byIgnore.kept;
const noise = uniqueNames(byNoise.noise);
const ignored = uniqueNames(byIgnore.noise).map((name) => ({ name, reason: ignoreList.find((e) => e.name === name).reason }));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ differences, noise, ignored }, null, 1));
} else {
  for (const d of differences) {
    console.log(`\n## ${d.name}`);
    if (d.missing !== undefined) { console.log(`  falta en ${d.missing === 'after' ? 'después' : 'antes'}`); continue; }
    if (d.before !== undefined) { console.log(`  texto antes:   ${d.before}`); console.log(`  texto después: ${d.after}`); continue; }
    for (const line of d.onlyBefore) console.log(`  - ${line}`);
    for (const line of d.onlyAfter) console.log(`  + ${line}`);
  }
  console.log(`\n${noise.length} casos descartados por ruido medido entre tandas: ${noise.join(' | ')}`);
  console.log(`${ignored.length} casos descartados por --ignore: ${ignored.map((e) => `${e.name} (${e.reason})`).join(' | ')}`);
  console.log(`\n[dom-text] ${uniqueNames(differences).length} comprobaciones con diferencias`);
}
process.exit(differences.length === 0 ? 0 : 1);
