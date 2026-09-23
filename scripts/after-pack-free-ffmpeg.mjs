// Hook `afterPack` de electron-builder: sustituye el ffmpeg de Electron por su build LIBRE.
//
// POR QUE (B.4 de la revision de licencias de terceros): Electron trae de serie un ffmpeg con codecs
// propietarios (H.264/AAC). Distribuirlos —y mas en un producto de pago— exige licencias de patentes
// (MPEG-LA/Via) que nadie ha firmado. **Mage no reproduce video ni audio**: el codec sobra, asi que la
// solucion no es pagar, es no llevarlo. Electron publica en cada release una build de ffmpeg SIN esos
// codecs; esto la descarga y pisa el binario dentro del paquete.
//
// Lo que NO se hace, a proposito: borrar el binario. Chromium lo carga al arrancar y la app no
// levantaria. Y ojo con la LGPL (ffmpeg): lo que salva la situacion es que se enlaza DINAMICAMENTE y
// el usuario puede sustituirlo. Si alguien añade verificacion de integridad del .dll «por seguridad»,
// rompe la LGPL sin enterarse.
//
// El hook FALLA RUIDOSAMENTE si no encuentra el binario que tiene que sustituir: un fallo silencioso
// aqui significa publicar los codecs propietarios creyendo que no van.

import { downloadArtifact } from '@electron/get';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Nombre del binario de ffmpeg y su ubicacion DENTRO del paquete, por plataforma de Electron.
const FFMPEG_TARGETS = {
  win32: { file: 'ffmpeg.dll', relativeDir: '.' },
  linux: { file: 'libffmpeg.so', relativeDir: '.' },
  darwin: { file: 'libffmpeg.dylib', relativeDir: 'Electron Framework.framework/Versions/A/Libraries' },
};

export default async function replaceWithFreeFfmpeg(context) {
  const platform = context.electronPlatformName;
  const target = FFMPEG_TARGETS[platform];
  if (target === undefined) throw new Error(`Plataforma de Electron no contemplada al sustituir ffmpeg: ${platform}`);

  const version = electronVersion(context);
  const arch = archName(context.arch);
  const packaged = locatePackagedFfmpeg(context.appOutDir, platform, target);
  const before = fs.statSync(packaged).size;

  const zipPath = await downloadArtifact({ version, artifactName: 'ffmpeg', platform, arch });
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-ffmpeg-'));
  try {
    unzip(zipPath, extractDir);
    const free = path.join(extractDir, target.file);
    if (!fs.existsSync(free)) throw new Error(`El zip de ffmpeg libre v${version} no contiene ${target.file} (extraido en ${extractDir})`);
    fs.copyFileSync(free, packaged);
    const after = fs.statSync(packaged).size;
    console.log(`[ffmpeg] build libre v${version} ${platform}-${arch}: ${target.file} ${before} -> ${after} bytes`);
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

// Descomprime con la herramienta del SISTEMA y no con una libreria. Medido el 2026-09-20: `extract-zip`
// (2.0.1, la que arrastra el propio electron-builder) devuelve en node 24 una promesa que NO SE
// RESUELVE NUNCA — ni cumple ni falla, el proceso se queda sin nada que hacer y termina en silencio,
// que es peor que un error.
//
// En Windows se usa PowerShell y NO `tar`: el `tar` que gana en el PATH puede ser el GNU de Git Bash,
// que interpreta `C:\...` como un host remoto y falla con «Cannot connect to C: resolve failed»
// (medido). `Expand-Archive` siempre esta y no tiene esa ambiguedad. En macOS y Linux, `unzip`.
function unzip(zipPath, destDir) {
  if (process.platform !== 'win32') {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
    return;
  }
  // Comillas simples de PowerShell: se escapan duplicandolas, que es lo unico que hay que escapar ahi.
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destDir)} -Force`],
    { stdio: 'inherit' },
  );
}

// Ruta del ffmpeg que electron-builder acaba de empaquetar. En macOS cuelga del .app, cuyo nombre
// depende de `productName`, asi que se busca en vez de construirlo a mano.
function locatePackagedFfmpeg(appOutDir, platform, target) {
  const candidates =
    platform === 'darwin'
      ? fs
          .readdirSync(appOutDir)
          .filter((entry) => entry.endsWith('.app'))
          .map((appDir) => path.join(appOutDir, appDir, 'Contents', 'Frameworks', target.relativeDir, target.file))
      : [path.join(appOutDir, target.relativeDir, target.file)];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found === undefined) {
    throw new Error(`No se encontro ${target.file} en el paquete (${appOutDir}). Sin sustituirlo se publicarian los codecs propietarios: se aborta.`);
  }
  return found;
}

// Version de Electron que se esta empaquetando. Se pregunta al packager (que es quien lo decide) y se
// cae al package.json de la dependencia; si ninguna lo dice, se aborta en vez de adivinar: descargar
// un ffmpeg de otra version produce una app que no arranca.
function electronVersion(context) {
  const fromPackager = context.packager?.info?.framework?.version ?? context.packager?.config?.electronVersion;
  if (typeof fromPackager === 'string' && fromPackager.length > 0) return fromPackager;
  const pkgPath = path.join(process.cwd(), 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error('No se pudo determinar la version de Electron para descargar su ffmpeg libre');
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  if (typeof version !== 'string' || version.length === 0) throw new Error(`Version de Electron ilegible en ${pkgPath}`);
  return version;
}

// electron-builder da la arquitectura como enum numerico (Arch.x64 = 1, arm64 = 3); @electron/get la
// quiere por nombre.
function archName(arch) {
  const names = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
  const name = names[arch];
  if (name === undefined) throw new Error(`Arquitectura no contemplada al sustituir ffmpeg: ${String(arch)}`);
  return name;
}
