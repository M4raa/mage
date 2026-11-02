// F2.7, paso previo (devolución 16): compatibilidad de bóvedas existentes. Empaqueta el `SecretStore` de una
// versión publicada (por defecto v0.1.2) y el del árbol actual, y en Windows mide en procesos separados:
//   viejo escribe → nuevo lee (lo que pasa al actualizar), y los controles viejo→viejo y nuevo→nuevo.
// Sin red, sin turnos, con texto sintético y perfiles desechables en el temporal. `--build-only <dir>` deja los
// bundles en <dir> para el lado Linux (`vault-compat-linux.sh`).
//
//   node spike/vault-compat.mjs [--from=v0.1.2] [--build-only <dir>]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
const electron = require('electron');

const from = (process.argv.find((arg) => arg.startsWith('--from=')) ?? '--from=v0.1.2').slice('--from='.length);
const buildOnlyIndex = process.argv.indexOf('--build-only');
const VAULT_FILES = ['src/main/secrets/secretStore.ts', 'src/main/os/atomicFile.ts'];

// El código de `ref` (o del árbol si ref es null) en una carpeta con la misma estructura, empaquetado con zod.
function bundle(ref, outFile, scratch) {
  const tree = path.join(scratch, ref ?? 'worktree');
  for (const file of VAULT_FILES) {
    const target = path.join(tree, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const source = ref === null ? fs.readFileSync(path.join(repo, file), 'utf8') : execFileSync('git', ['show', `${ref}:${file}`], { cwd: repo, encoding: 'utf8' });
    fs.writeFileSync(target, source);
  }
  esbuild.buildSync({ entryPoints: [path.join(tree, VAULT_FILES[0])], bundle: true, platform: 'node', format: 'cjs', outfile: outFile, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'error' });
  return outFile;
}

function buildBundles(outDir) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-vault-compat-src-'));
  try {
    fs.mkdirSync(outDir, { recursive: true });
    return { old: bundle(from, path.join(outDir, `secretStore-${from}.cjs`), scratch), current: bundle(null, path.join(outDir, 'secretStore-HEAD.cjs'), scratch) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function probe(profile, impl, action) {
  // Sin ELECTRON_RUN_AS_NODE: con esa variable presente (aunque vacía) Electron arranca como Node y no hay `app`.
  const { ELECTRON_RUN_AS_NODE: _asNode, ...inherited } = process.env;
  const result = spawnSync(electron, [path.join(repo, 'spike/vault-compat.cjs')], {
    env: { ...inherited, MAGE_VC_PROFILE: profile, MAGE_VC_IMPL: impl, MAGE_VC_ACTION: action },
    encoding: 'utf8', timeout: 30_000,
  });
  const line = (result.stdout ?? '').split('\n').find((text) => text.startsWith('{'));
  if (line === undefined) throw new Error(`La sonda no respondió (exit ${result.status}): ${result.stderr}`);
  return JSON.parse(line);
}

function pair(label, writer, reader) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-vault-compat-'));
  try {
    const written = probe(profile, writer, 'write');
    const read = written.ok ? probe(profile, reader, 'read') : null;
    const row = { case: label, written, read, compatible: written.ok && read?.ok === true && read.matches === true };
    console.log(JSON.stringify(row));
    return row;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (buildOnlyIndex !== -1) {
  const outDir = process.argv[buildOnlyIndex + 1];
  if (outDir === undefined) throw new Error('--build-only necesita una carpeta');
  console.log(JSON.stringify(buildBundles(path.resolve(outDir))));
} else {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-vault-compat-bundles-'));
  try {
    const { old, current } = buildBundles(outDir);
    const rows = [pair(`${from}→HEAD`, old, current), pair(`${from}→${from}`, old, old), pair('HEAD→HEAD', current, current)];
    console.log(JSON.stringify({ summary: rows.every((row) => row.compatible) ? 'compatible' : 'INCOMPATIBLE' }));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
