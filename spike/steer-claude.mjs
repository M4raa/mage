// Spike de F4.1 (carril G): el directo de Claude con el código REAL de Mage (ClaudeAdapter) contra el CLI real y un servidor Anthropic FALSO: sin cuota. Tres casos: absorbido en el turno, turno propio y con un permiso pendiente.
//   node spike/steer-claude.mjs --build-only   solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/steer-claude.mjs                lanza `claude` tres veces contra el servidor falso (clave falsa, carpetas temporales)
// Sale con 1 si algo no da lo esperado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { linguiCatalogPlugin } from '../scripts/lib/linguiEsbuildPlugin.mjs';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);

async function build(outDir) {
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = path.join(outDir, 'steer-claude-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/steer-claude-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return outfile;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function expected(out) {
  const { absorbido, turnoPropio, permisoPendiente } = out.casos ?? {};
  const permiso = permisoPendiente?.steer ?? [];
  return same(absorbido?.steer, ['active_turn']) && same(turnoPropio?.steer, ['new_turn'])
    && permiso.length === 1 && ['active_turn', 'new_turn'].includes(permiso[0])
    && ![absorbido, turnoPropio, permisoPendiente].some((c) => c?.inferred === true);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-g-steer-claude-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const spike = createRequire(import.meta.url)(bundle);
    console.log(`claude: ${spike.claudeBinary()}`);
    const out = await spike.run();
    const ok = expected(out);
    console.log(JSON.stringify({ ok, ...out }, null, 1));
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
