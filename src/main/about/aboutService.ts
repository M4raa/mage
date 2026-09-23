import fs from 'node:fs';
import path from 'node:path';
import type { AboutInfo } from '@shared/ipc';

// Datos de la pantalla «Acerca de» (B.2/B.3 de la revision de licencias de terceros): version, versiones
// del runtime y —lo que de verdad importa— los AVISOS DE TERCEROS.
//
// Las 85 dependencias de produccion son permisivas, pero todas exigen conservar su aviso de copyright
// al redistribuir, y el bundle los borra (el minificador se come los comentarios y el asar excluye
// `node_modules`). `THIRD-PARTY-NOTICES.txt` lo genera `pnpm notices` y viaja DENTRO del asar; esto es
// lo que lo lee para que la app pueda enseñarlo.
//
// Chromium y Electron traen sus propios avisos en `LICENSES.chromium.html`, que electron-builder
// instala junto al ejecutable. No se copia ni se reempaqueta: se localiza y se abre con el sistema.

export const NOTICES_FILENAME = 'THIRD-PARTY-NOTICES.txt';
export const CHROMIUM_LICENSES_FILENAME = 'LICENSES.chromium.html';

// Rutas que dependen de Electron. Se inyectan (no se importa `app` aqui) para poder testear el modulo
// sin arrancar Electron, que es el patron del resto de servicios de main.
export interface AboutPaths {
  // `app.getAppPath()`: la raiz del asar empaquetado, o la del repo en desarrollo.
  readonly appPath: string;
  // Carpeta del ejecutable: al lado vive `LICENSES.chromium.html` en la app instalada.
  readonly exeDir: string;
  // Carpeta de `electron/dist` en desarrollo, donde vive ese mismo fichero antes de empaquetar.
  readonly electronDistDir: string;
}

export interface AboutVersions {
  readonly app: string;
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
}

// Lector de ficheros inyectable (test sin tocar disco).
export interface AboutFs {
  readonly existsSync: (p: string) => boolean;
  readonly readFileSync: (p: string, encoding: 'utf8') => string;
}

export function buildAboutInfo(paths: AboutPaths, versions: AboutVersions, files: AboutFs = fs): AboutInfo {
  return {
    versions,
    notices: readNotices(paths, files),
    chromiumLicensesPath: findChromiumLicenses(paths, files),
  };
}

// Texto de los avisos de terceros. Si el fichero no esta (alguien empaqueto sin generarlo), se devuelve
// un mensaje que lo DICE en vez de una pantalla vacia: un hueco en blanco se interpreta como "no hay
// terceros", que es justo lo contrario de la verdad.
function readNotices(paths: AboutPaths, files: AboutFs): string {
  const target = path.join(paths.appPath, NOTICES_FILENAME);
  if (!files.existsSync(target)) {
    return `No se encontró ${NOTICES_FILENAME} en esta instalación. Se genera con \`pnpm notices\` y debe viajar con la aplicación.`;
  }
  return files.readFileSync(target, 'utf8');
}

// Primera ubicacion donde exista `LICENSES.chromium.html`: junto al ejecutable (app instalada) o en
// `electron/dist` (desarrollo). `null` si no esta en ninguna — entonces la UI no ofrece el enlace, en
// vez de abrir una ruta que no existe.
function findChromiumLicenses(paths: AboutPaths, files: AboutFs): string | null {
  const candidates = [path.join(paths.exeDir, CHROMIUM_LICENSES_FILENAME), path.join(paths.electronDistDir, CHROMIUM_LICENSES_FILENAME)];
  return candidates.find((candidate) => files.existsSync(candidate)) ?? null;
}
