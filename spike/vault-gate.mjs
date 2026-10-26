// F2.7 (D1): empaqueta el código de producción de la comprobación de la bóveda (`vault-gate-entry.ts`) y, en Windows,
// ejecuta la sonda una vez (round trip real con DPAPI). `--build-only <dir>` deja el bundle para Linux
// (`vault-gate-linux.sh`). Sin red ni turnos; texto sintético y perfiles desechables.
//
//   node spike/vault-gate.mjs [--build-only <dir>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
const electron = require('electron');

function build(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, 'vault-gate-bundle.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(repo, 'spike/vault-gate-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    external: ['electron'], alias: { '@shared': path.join(repo, 'src/shared') }, logLevel: 'error',
  });
  return outfile;
}

function runProbe(bundle) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-vault-gate-run-'));
  const profile = fs.mkdtempSync(path.join(root, 'mage-vault-gate-'));
  const home = fs.mkdtempSync(path.join(root, 'mage-vault-gate-'));
  try {
    // Sin ELECTRON_RUN_AS_NODE: con esa variable presente Electron arranca como Node y no hay `app`.
    const { ELECTRON_RUN_AS_NODE: _asNode, ...inherited } = process.env;
    const result = spawnSync(electron, [path.join(repo, 'spike/vault-gate-probe.cjs')], {
      env: { ...inherited, MAGE_VG_PROFILE: profile, MAGE_VG_HOME: home, MAGE_VG_BUNDLE: bundle }, encoding: 'utf8', timeout: 60_000,
    });
    const line = (result.stdout ?? '').split('\n').find((text) => text.startsWith('{'));
    if (line === undefined) throw new Error(`La sonda no respondió (exit ${result.status}): ${result.stderr}`);
    console.log(line);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const buildOnlyIndex = process.argv.indexOf('--build-only');
if (buildOnlyIndex !== -1) {
  const outDir = process.argv[buildOnlyIndex + 1];
  if (outDir === undefined) throw new Error('--build-only necesita una carpeta');
  console.log(build(path.resolve(outDir)));
} else {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-vault-gate-bundle-'));
  try {
    runProbe(build(outDir));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
