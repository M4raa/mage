// Limpieza de una sola vez: lista (y con `--apply` borra) las carpetas temporales de chat que dejaron los Mage de prueba
// en la raíz local antes de que se guardaran en su casa de prueba.
// Por defecto solo LISTA; borra únicamente con `--apply`. Nunca toca el perfil de la app instalada, el de desarrollo
// ni nada que no tenga forma de carpeta de perfil (16 hex).
// Uso: node scripts/clean-test-scratch.mjs [--apply]
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { localMageRootFor, profileHash, staleProfileDirs, userProfilePaths } from './lib/staleScratchProfiles.mjs';

const APPLY_FLAG = '--apply';
const BAD_ARGUMENT_EXIT = 2;

function parseArgs(args) {
  const unknown = args.find((arg) => arg !== APPLY_FLAG);
  if (unknown !== undefined) {
    console.error(`Argumento desconocido: ${unknown} (solo se admite ${APPLY_FLAG})`);
    process.exit(BAD_ARGUMENT_EXIT);
  }
  return { apply: args.includes(APPLY_FLAG) };
}

function listProfileDirNames(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function reportKept(names, keepPaths) {
  for (const userData of keepPaths) {
    const hash = profileHash(userData);
    if (names.includes(hash)) console.log(`Se conservan: ${hash} (${userData})`);
  }
}

function removeAll(root, stale) {
  let removed = 0;
  for (const name of stale) {
    try {
      fs.rmSync(join(root, name), { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      console.error(`No se pudo borrar ${name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`Borradas ${removed} de ${stale.length}.`);
}

function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const system = { platform: process.platform, env: process.env, home: os.homedir() };
  const root = localMageRootFor(system);
  if (!fs.existsSync(root)) {
    console.log(`No existe ${root}: nada que limpiar.`);
    return;
  }
  const names = listProfileDirNames(root);
  const keepPaths = userProfilePaths(system);
  const stale = staleProfileDirs(names, keepPaths);
  reportKept(names, keepPaths);
  console.log(`Sobran ${stale.length} carpetas en ${root}:`);
  for (const name of stale) console.log(`  ${name}`);
  if (!apply) {
    console.log(`Simulación: no se ha borrado nada. Para borrarlas: node scripts/clean-test-scratch.mjs ${APPLY_FLAG}`);
    return;
  }
  removeAll(root, stale);
}

main();
