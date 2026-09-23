import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildAboutInfo, CHROMIUM_LICENSES_FILENAME, NOTICES_FILENAME, type AboutFs, type AboutPaths } from './aboutService';

const PATHS: AboutPaths = {
  appPath: path.join('C:', 'app', 'resources', 'app.asar'),
  exeDir: path.join('C:', 'app'),
  electronDistDir: path.join('C:', 'repo', 'node_modules', 'electron', 'dist'),
};

const VERSIONS = { app: '0.1.0', electron: '34.5.8', chromium: '132.0.0.0', node: '20.18.1' };

// FS falso: un mapa de ruta -> contenido. Las rutas que no esten, no existen.
function fakeFs(files: Readonly<Record<string, string>>): AboutFs {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      const content = files[p];
      if (content === undefined) throw new Error(`fichero inexistente: ${p}`);
      return content;
    },
  };
}

describe('aboutService', () => {
  it('buildAboutInfo_conAvisosEnElAsar_devuelveSuTextoCompleto', () => {
    const notices = 'AVISOS DE TERCEROS — Mage\n\nPermission is hereby granted...';
    const files = fakeFs({ [path.join(PATHS.appPath, NOTICES_FILENAME)]: notices });

    const info = buildAboutInfo(PATHS, VERSIONS, files);

    expect(info.notices).toBe(notices);
    expect(info.versions).toEqual(VERSIONS);
  });

  // Un hueco en blanco se lee como "Mage no usa software de terceros", que es lo contrario de la
  // verdad: si el fichero falta, la pantalla tiene que decirlo.
  it('buildAboutInfo_sinFicheroDeAvisos_explicaQueFaltaEnVezDeVolverVacio', () => {
    const info = buildAboutInfo(PATHS, VERSIONS, fakeFs({}));

    expect(info.notices).toContain(NOTICES_FILENAME);
    expect(info.notices).not.toBe('');
  });

  it('buildAboutInfo_appInstalada_encuentraLosAvisosDeChromiumJuntoAlEjecutable', () => {
    const instalado = path.join(PATHS.exeDir, CHROMIUM_LICENSES_FILENAME);

    const info = buildAboutInfo(PATHS, VERSIONS, fakeFs({ [instalado]: '<html>' }));

    expect(info.chromiumLicensesPath).toBe(instalado);
  });

  it('buildAboutInfo_enDesarrollo_caeAElectronDist', () => {
    const enDist = path.join(PATHS.electronDistDir, CHROMIUM_LICENSES_FILENAME);

    const info = buildAboutInfo(PATHS, VERSIONS, fakeFs({ [enDist]: '<html>' }));

    expect(info.chromiumLicensesPath).toBe(enDist);
  });

  it('buildAboutInfo_sinAvisosDeChromiumEnNingunSitio_devuelveNull', () => {
    expect(buildAboutInfo(PATHS, VERSIONS, fakeFs({})).chromiumLicensesPath).toBeNull();
  });
});
