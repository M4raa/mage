// Prueba de la actualizacion de punta a punta SIN publicar nada (grupo B de la 0.1.2): una «0.1.2» y una
// «0.1.3» falsa construidas en local, y un servidor `generic` en 127.0.0.1 que sirve la segunda.
//
// POR QUE: el dialogo de «lista para instalar» solo lo pinta el codigo de la version INSTALADA, asi que
// la 0.1.1 publicada enseñara el suyo (el nativo) al recibir la 0.1.2; la primera vez que se veria el
// nuevo de verdad seria al publicar la 0.1.3. Esto lo adelanta.
//
// POR QUE OTRA APP: las dos builds llevan otro appId, otro productName y otro `name`, asi que se
// instalan en su propia carpeta (%LOCALAPPDATA%\Programs\MageUpdateTest), con su propia entrada de
// «Aplicaciones» y su propio userData (%APPDATA%\MageUpdateTest). La Mage instalada de verdad, sus
// ajustes y su updater no se tocan: instalar la 0.1.3 falsa encima de la real la dejaria apuntando a
// este servidor para siempre.
//
// Uso (Windows, desde la raiz del repo):
//   node scripts/update-test.mjs build   # `pnpm run build` + las dos builds en release/update-test/
//   node scripts/update-test.mjs serve   # sirve release/update-test/to en http://127.0.0.1:8765/
// Y a mano:
//   1. Instalar release/update-test/from/mage-setup-beta-<version>.exe (asistente de Mage, idioma es_ES).
//   2. Con `serve` en marcha, abrir MageUpdateTest. A los ~20 s descarga la 0.1.3: el dialogo propio
//      sale en la ventana enfocada (con las notas de abajo) y la barra de estado dice «0.1.3 lista».
//      Con la ventana en la bandeja no sale nada hasta volver a abrirla.
//   3. «Reiniciar ahora»: el asistente de actualizacion (sin bienvenida ni carpeta) y Mage vuelve en la
//      0.1.3, con la pestaña de novedades abierta.
//   4. Desinstalar MageUpdateTest desde «Aplicaciones» y borrar %APPDATA%\MageUpdateTest.
// Nunca publica: `--publish never` y sin GH_TOKEN.
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outRoot = path.join(repoRoot, 'release', 'update-test');
const PORT = 8765;
const FAKE_VERSION = '0.1.3';
const FAKE_NOTES = [
  '### Añadido',
  '- Versión **falsa** de la prueba local de actualización (`scripts/update-test.mjs`).',
  '- Si lees esto en el diálogo de Mage, las notas llegan desde `latest.yml`.',
  '',
  '### Corregido',
  '- Nada: no se publica nunca.',
].join('\n');

// Lo que separa esta app de la Mage de verdad (ver cabecera).
const ISOLATION = [
  '-c.appId=com.m4raa.mage.updatetest',
  '-c.productName=MageUpdateTest',
  '-c.extraMetadata.name=mage-update-test',
  '-c.extraMetadata.productName=MageUpdateTest',
];

// El `publish` de GitHub no se puede pisar con -c (electron-builder FUSIONA el objeto y el `owner`/`repo`
// que quedan no valen para `generic`): se escribe una copia de electron-builder.yml con ese bloque
// cambiado. Las rutas del yml son relativas al proyecto, no al fichero, asi que la copia vale tal cual.
function writeConfig() {
  const original = readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf-8').replace(/\r\n/g, '\n');
  const block = /^publish:\n(?:[ ]{2}.*\n)+/m;
  if (!block.test(original)) throw new Error('electron-builder.yml no tiene el bloque `publish:` esperado');
  const file = path.join(outRoot, 'electron-builder.update-test.yml');
  writeFileSync(file, original.replace(block, `publish:\n  provider: generic\n  url: http://127.0.0.1:${PORT}/\n`), 'utf-8');
  return file;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', shell: true, env: withoutGhToken() });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} termino con ${result.status}`);
}

// Por si acaso: sin token, electron-builder no puede publicar aunque se lo pidiera algo.
function withoutGhToken() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

function buildInstaller(config, outDir, extra) {
  const args = ['--config', config, '--win', 'nsis', '--x64', '--publish', 'never', ...ISOLATION, `-c.directories.output=${outDir}`];
  run('pnpm', ['exec', 'electron-builder', ...args, ...extra]);
}

function build() {
  run('pnpm', ['run', 'build']);
  mkdirSync(outRoot, { recursive: true });
  const notesFile = path.join(outRoot, `NOTES-${FAKE_VERSION}.md`);
  writeFileSync(notesFile, `${FAKE_NOTES}\n`, 'utf-8');
  const config = writeConfig();
  buildInstaller(config, path.join(outRoot, 'from'), []);
  buildInstaller(config, path.join(outRoot, 'to'), [`-c.extraMetadata.version=${FAKE_VERSION}`, `-c.releaseInfo.releaseNotesFile=${notesFile}`]);
  console.log(`[update-test] listo: instala release/update-test/from y luego «serve»`);
}

// Servidor estatico minimo de la carpeta `to` (latest.yml, el .exe y su .blockmap). Solo GET, solo
// ficheros de esa carpeta: nada de rutas con `..`.
function serve() {
  const root = path.join(outRoot, 'to');
  if (!existsSync(path.join(root, 'latest.yml'))) throw new Error(`No hay ${path.join(root, 'latest.yml')}: ejecuta «build» antes`);
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    const file = path.join(root, name);
    const inside = path.relative(root, file);
    if (req.method !== 'GET' || name === '' || inside.startsWith('..') || !existsSync(file) || !statSync(file).isFile()) {
      console.log(`[update-test] 404 ${req.method} ${req.url}`);
      res.writeHead(404).end();
      return;
    }
    console.log(`[update-test] 200 ${req.url}`);
    res.writeHead(200, { 'Content-Length': statSync(file).size });
    createReadStream(file).pipe(res);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const version = /^version:\s*(\S+)/m.exec(readFileSync(path.join(root, 'latest.yml'), 'utf-8'))?.[1];
    console.log(`[update-test] sirviendo ${version} en http://127.0.0.1:${PORT}/ (Ctrl+C para parar)`);
  });
}

const command = process.argv[2];
if (command === 'build') build();
else if (command === 'serve') serve();
else throw new Error(`Uso: node scripts/update-test.mjs build|serve (recibido: ${JSON.stringify(command)})`);
