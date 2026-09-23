import { describe, expect, it } from 'vitest';
import { buildBugReportUrl, buildIdeaUrl, GITHUB_REPO, issueOsFromPlatform } from './bugReport';

// Lo que estas pruebas protegen no es la cadena: es que el formulario de GitHub salga RELLENO. Si un
// nombre de parametro deja de casar con el `id` del campo en `fallo.yml`, GitHub no avisa —abre el
// formulario vacio— y nadie se entera hasta leer el primer informe sin version.

describe('issueOsFromPlatform', () => {
  it('platformWin32_devuelveWindows', () => {
    expect(issueOsFromPlatform('Win32')).toBe('Windows');
  });

  it('platformMacIntel_devuelveMacOS', () => {
    expect(issueOsFromPlatform('MacIntel')).toBe('macOS');
  });

  it('platformLinuxX8664_devuelveLinux', () => {
    expect(issueOsFromPlatform('Linux x86_64')).toBe('Linux');
  });

  it('platformDesconocida_devuelveNull', () => {
    // Antes que adivinar, nada: el desplegable se queda sin elegir y lo pone la persona.
    expect(issueOsFromPlatform('FreeBSD amd64')).toBeNull();
  });

  it('platformVacia_devuelveNull', () => {
    expect(issueOsFromPlatform('')).toBeNull();
  });
});

describe('buildBugReportUrl', () => {
  it('versionYPlataformaConocidas_rellenaAmbosCampos', () => {
    const url = new URL(buildBugReportUrl({ appVersion: '0.1.0', platform: 'Win32' }));

    expect(url.origin + url.pathname).toBe(`https://github.com/${GITHUB_REPO}/issues/new`);
    expect(url.searchParams.get('template')).toBe('fallo.yml');
    // `bug` y no `fallo`: GitHub descarta las etiquetas que no existen ya en el repositorio, y `bug`
    // viene de serie. Tiene que seguir casando con el `labels:` de `.github/ISSUE_TEMPLATE/fallo.yml`.
    expect(url.searchParams.get('labels')).toBe('bug');
    expect(url.searchParams.get('version')).toBe('0.1.0');
    expect(url.searchParams.get('so')).toBe('Windows');
  });

  it('versionNull_omiteElCampoEnVezDeEscribirNull', () => {
    const url = new URL(buildBugReportUrl({ appVersion: null, platform: 'MacIntel' }));

    // La etiqueta NO depende de que se conozcan version ni SO: va siempre.
    expect(url.searchParams.get('labels')).toBe('bug');
    expect(url.searchParams.has('version')).toBe(false);
    expect(url.searchParams.get('so')).toBe('macOS');
  });

  it('versionSoloEspacios_omiteElCampo', () => {
    const url = new URL(buildBugReportUrl({ appVersion: '   ', platform: 'Linux x86_64' }));

    expect(url.searchParams.has('version')).toBe(false);
  });

  it('plataformaDesconocida_omiteElDesplegablePeroMantieneLaVersion', () => {
    const url = new URL(buildBugReportUrl({ appVersion: '0.1.0', platform: 'FreeBSD' }));

    expect(url.searchParams.has('so')).toBe(false);
    expect(url.searchParams.get('version')).toBe('0.1.0');
  });

  it('versionConCaracteresRaros_vaEscapadaYNoRompeLaUrl', () => {
    // Una version de desarrollo puede traer `+` o espacios; sin escapar cambiarian de significado en
    // la query (un `+` se lee como espacio) y el formulario saldria con un dato falso.
    const url = new URL(buildBugReportUrl({ appVersion: '0.1.0+dev build', platform: 'Win32' }));

    expect(url.searchParams.get('version')).toBe('0.1.0+dev build');
  });
});

describe('buildIdeaUrl', () => {
  it('sinContexto_apuntaAIdeaYmlConLaEtiquetaQueExiste', () => {
    const url = new URL(buildIdeaUrl());

    expect(url.origin + url.pathname).toBe(`https://github.com/${GITHUB_REPO}/issues/new`);
    expect(url.searchParams.get('template')).toBe('idea.yml');
    // `enhancement` y no `idea`: GitHub descarta en silencio las etiquetas que no existen ya en el
    // repositorio. Tiene que seguir casando con el `labels:` de `.github/ISSUE_TEMPLATE/idea.yml`.
    expect(url.searchParams.get('labels')).toBe('enhancement');
  });

  it('noMandaVersionNiSo_porqueIdeaYmlNoTieneEsosCampos', () => {
    const url = new URL(buildIdeaUrl());

    expect(url.searchParams.has('version')).toBe(false);
    expect(url.searchParams.has('so')).toBe(false);
  });

  it('noEsLaMismaUrlQueLaDelFallo', () => {
    // Protege el copy-paste: dos botones pegados que abriesen el mismo formulario es justo el fallo
    // que nadie mira dos veces.
    expect(buildIdeaUrl()).not.toBe(buildBugReportUrl({ appVersion: null, platform: 'Win32' }));
  });
});
