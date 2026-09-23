// Spike: QUE OFRECE de verdad el CLI `codex` de OpenAI.
//
// POR QUE EXISTE: la skill `protocolo-cli` del repo lo exige antes de escribir un adapter, y con
// motivo — el proyecto ya se equivoco dos veces: una creyendose documentacion de segunda mano del CLI
// (era de otra version) y otra descartando `agy` porque su `--help` no mencionaba `--output-format`,
// que si existia. Un hallazgo sin spike reproducible no vale.
//
// Uso: node spike/codex-spike.mjs
//      node spike/codex-spike.mjs "C:/ruta/a/codex.exe"   (si no esta en el PATH)
import { spawnSync } from 'node:child_process';

const bin = process.argv[2] ?? (process.platform === 'win32' ? 'codex.exe' : 'codex');

const run = (args, entrada) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', input: entrada, timeout: 30_000, windowsHide: true });
  if (r.error !== undefined && r.error !== null) return `NO SE PUDO EJECUTAR: ${r.error.message}`;
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
};

const primeraLinea = (texto) => texto.split('\n')[0]?.trim() ?? '';

console.log('# Spike de codex — ' + bin);
console.log('\n## 1. Version (un hallazgo sin version no es reproducible)');
console.log(primeraLinea(run(['--version'])));

console.log('\n## 2. Salida estructurada');
const execHelp = run(['exec', '--help']);
for (const flag of ['--json', '--output-last-message', '--output-schema']) {
  console.log(`  ${flag.padEnd(24)} ${execHelp.includes(flag) ? 'SI' : 'no'}`);
}

console.log('\n## 3. Entrada, cwd y multi-turno');
for (const flag of ['--cd', '--add-dir', '--model', '--sandbox', '--ephemeral', '--skip-git-repo-check']) {
  console.log(`  ${flag.padEnd(24)} ${execHelp.includes(flag) ? 'SI' : 'no'}`);
}
console.log(`  exec resume              ${execHelp.includes('resume') ? 'SI' : 'no'}`);
console.log('  (el PROMPT se puede pasar por stdin: "If not provided as an argument ... read from stdin")');

console.log('\n## 4. PERMISOS — el punto que decide si cumple la decision nº 2 de Mage');
// El oraculo de flags: un flag que NO existe se rechaza con "unexpected argument"; uno que existe da
// otro error (o un aviso). Es gratis y no gasta ninguna peticion al modelo.
for (const flag of ['--permission-prompt-tool', '--approval-mode', '--ask-for-approval', '--full-auto']) {
  const salida = primeraLinea(run(['exec', flag]));
  const existe = !salida.includes('unexpected argument');
  console.log(`  ${flag.padEnd(28)} ${existe ? 'EXISTE' : 'no existe'}  — ${salida.slice(0, 90)}`);
}
console.log('  Politicas de --sandbox: read-only | workspace-write | danger-full-access (ESTATICAS,');
console.log('  no es un puente de permisos: Mage no puede contestar a nada).');

console.log('\n## 5. Catalogo de modelos');
const rootHelp = run(['--help']);
console.log(`  ¿hay un comando que liste modelos?  ${/\bmodels\b/.test(rootHelp) ? 'SI' : 'NO'}`);
console.log('  (`features list` es de feature flags, no de modelos. Mismo caso que Claude Code.)');

console.log('\n## 6. Sesion');
console.log(primeraLinea(run(['login', 'status'])));
console.log('  Sin cuenta NO se puede medir el stream de eventos de un turno real, que es lo unico que');
console.log('  falta para escribir el adapter. Con cuenta: `codex exec --json "di hola"` y anotar aqui');
console.log('  los tipos de evento, si traen `usage`, y donde acaba un fichero escrito (agy reportaba');
console.log('  bien el cwd y escribia en otro sitio: comprobar SIEMPRE el disco, no el evento).');
