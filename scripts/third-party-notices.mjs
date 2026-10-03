// Genera `THIRD-PARTY-NOTICES.txt` con el texto de licencia de CADA dependencia de PRODUCCION.
//
// POR QUE EXISTE (B.2/B.3 de la revision de licencias de terceros): las 85 dependencias que viajan en el
// binario son permisivas, pero TODAS (MIT, ISC, BSD...) exigen lo mismo — conservar el aviso de
// copyright y el texto de la licencia en las redistribuciones. El bundle los borra: el minificador se
// come los comentarios y `electron-builder.yml` excluye `node_modules`, asi que los ficheros `LICENSE`
// tampoco viajan. Medido: `grep -c "Permission is hereby granted" out/**` -> 0 en los dos bundles.
// Este fichero externo es lo que satisface la clausula, y la pantalla «Acerca de» es donde se muestra.
//
// COMO: `pnpm licenses list --json` da el paquete, su version, su licencia SPDX y su ruta en el store;
// de ahi se lee el fichero de licencia REAL (con su copyright, que es lo que hay que conservar). Solo
// entran los paquetes que el build deja DE VERDAD en los bundles (`third-party-bundle.json`, que escribe
// `scripts/bundledPackagesPlugin.ts` en cada `pnpm build`; B7 de la revision del runtime): lo instalado
// que no viaja (la pila de servidor del SDK de MCP, p.ej.) no se anuncia.
// Un paquete sin fichero cae al texto canonico de su SPDX + su autor: es lo unico que se puede
// atribuir, y decirlo es mejor que omitir el paquete.
//
// USO:
//   node scripts/third-party-notices.mjs           regenera el fichero
//   node scripts/third-party-notices.mjs --check   falla si el commiteado no coincide (CI)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.txt');
const BUNDLE_MANIFEST = path.join(ROOT, 'third-party-bundle.json');
// Nombres de fichero de licencia, en orden de preferencia. `LICENSE` antes que `README` siempre: un
// README puede citar la licencia de otra cosa.
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'COPYING', 'COPYING.txt'];

function main() {
  const packages = collectPackages();
  if (packages.length === 0) throw new Error('`pnpm licenses list --json` no devolvio ningun paquete de los bundles: sin eso no hay avisos que generar');
  const text = renderNotices(packages);
  if (!process.argv.includes('--check')) {
    fs.writeFileSync(OUTPUT, text, 'utf8');
    console.log(`[notices] ${packages.length} paquetes -> ${path.relative(ROOT, OUTPUT)} (${Math.round(text.length / 1024)} kB)`);
    return;
  }
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
  if (current === text) {
    console.log(`[notices] al dia: ${packages.length} paquetes`);
    return;
  }
  console.error(
    `[notices] THIRD-PARTY-NOTICES.txt NO coincide con las dependencias instaladas (${packages.length} paquetes).\n` +
      '          Ejecuta `pnpm notices` y commitea el resultado: publicar binarios sin estos avisos incumple\n' +
      '          las licencias MIT/ISC/BSD de las dependencias.',
  );
  process.exit(1);
}

// Los paquetes que el build dejo en algun bundle (main, preload o renderer).
function bundledPackageNames() {
  if (!fs.existsSync(BUNDLE_MANIFEST)) throw new Error(`Falta ${path.basename(BUNDLE_MANIFEST)}: ejecuta \`pnpm build\` (lo escribe el build) y vuelve a lanzar esto`);
  const manifest = JSON.parse(fs.readFileSync(BUNDLE_MANIFEST, 'utf8'));
  return new Set(Object.values(manifest).flat());
}

// Paquetes de los bundles, ordenados por nombre y con el texto de su licencia ya resuelto.
function collectPackages() {
  const bundled = bundledPackageNames();
  // `execSync` con la linea entera y no `execFileSync`: en Windows, node 24 se niega a lanzar un `.cmd`
  // sin shell (EINVAL), y `pnpm` es un `.cmd`. El comando es literal, sin nada interpolado.
  const raw = execSync('pnpm licenses list --json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const byLicense = JSON.parse(raw);
  const packages = [];
  for (const [license, entries] of Object.entries(byLicense)) {
    for (const entry of entries) {
      if (!bundled.has(entry.name)) continue;
      packages.push({
        name: entry.name,
        versions: entry.versions ?? [],
        license,
        author: typeof entry.author === 'string' ? entry.author : '',
        homepage: typeof entry.homepage === 'string' ? entry.homepage : '',
        text: readLicenseText(entry.paths ?? []),
      });
    }
  }
  const found = new Set(packages.map((pkg) => pkg.name));
  const missing = [...bundled].filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Paquetes de los bundles sin licencia en \`pnpm licenses list\`: ${missing.join(', ')}`);
  return packages.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

// Texto de licencia del paquete: el primer fichero que exista en la primera ruta que lo tenga. '' si
// ninguna lo trae (el llamante decide que poner en su lugar).
function readLicenseText(paths) {
  for (const dir of paths) {
    for (const file of LICENSE_FILES) {
      const candidate = path.join(dir, file);
      if (!fs.existsSync(candidate)) continue;
      const text = fs.readFileSync(candidate, 'utf8').trim();
      if (text.length > 0) return text;
    }
  }
  return '';
}

function renderNotices(packages) {
  const counts = new Map();
  for (const pkg of packages) counts.set(pkg.license, (counts.get(pkg.license) ?? 0) + 1);
  const resumen = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([license, count]) => `${license} (${count})`).join(' · ');
  const header = [
    'AVISOS DE TERCEROS — Mage',
    '',
    'Mage incorpora software de terceros. Abajo va, para cada paquete cuyo codigo entra en los bundles',
    'de la aplicacion, su licencia completa con su aviso de copyright. Este fichero se genera con',
    '`pnpm notices` a partir de lo que el build deja en esos bundles; no se edita a mano.',
    '',
    `Paquetes: ${packages.length} · Licencias: ${resumen}`,
    '',
    'Electron y Chromium: sus avisos viajan aparte, en el fichero LICENSES.chromium.html que se',
    'instala junto a la aplicacion. ffmpeg se enlaza dinamicamente bajo LGPL-2.1-or-later; su',
    'biblioteca es reemplazable sustituyendo el binario que acompana a la aplicacion.',
    '',
  ].join('\n');
  const bodies = packages.map(renderPackage).join('\n');
  // Finales de linea LF SIEMPRE: los ficheros de licencia vienen unos con CRLF y otros con LF, y el
  // repo normaliza a LF (.gitattributes). Sin esto, `--check` compara lo que se acaba de generar en
  // Windows con lo que dejo el checkout y falla por los retornos de carro, no por las dependencias.
  return `${header}${bodies}`.replace(/\r\n/g, '\n');
}

function renderPackage(pkg) {
  const version = pkg.versions.length > 0 ? ` ${pkg.versions.join(', ')}` : '';
  const autor = pkg.author.length > 0 ? `Autor: ${pkg.author}\n` : '';
  // Sin fichero de licencia en el paquete no se puede reproducir su aviso: se dice cual es la licencia
  // declarada y quien es el autor, que es exactamente lo que se sabe. Callarlo seria peor.
  const cuerpo = pkg.text.length > 0 ? pkg.text : `Licencia declarada: ${pkg.license}. El paquete no incluye fichero de licencia.`;
  return `${'='.repeat(100)}\n${pkg.name}${version} — ${pkg.license}\n${autor}${'='.repeat(100)}\n\n${cuerpo}\n\n`;
}

main();
