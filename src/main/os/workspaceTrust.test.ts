import { describe, expect, it } from 'vitest';
import { ancestorKeys, isTrusted, readCliTrustedFolders, trustKey, trustedProjectKeys } from './workspaceTrust';

// Frontera de seguridad: decide si se lanza un agente dentro de una carpeta, y lanzarlo ejecuta lo que
// esa carpeta traiga. Los casos que importan aqui no son el happy path sino los bordes por donde se
// cuela un "si" que nadie dio: rutas escritas de otra forma, ficheros a medio escribir, formas que no
// encajan. En todos ellos el lado seguro es NO confiar (o volver a preguntar), nunca al reves.

describe('trustKey', () => {
  it('trustKey_rutaConBarrasInvertidas_lasPasaABarrasNormales', () => {
    // Es la forma que usa el CLI en su config (`normalizePathForConfigKey`), y por eso Mage puede leer
    // lo que el usuario ya autorizo alli.
    expect(trustKey('C:\\sourcecode\\mage')).toBe('C:/sourcecode/mage');
  });

  it('trustKey_rutaConBarraFinal_laQuita', () => {
    expect(trustKey('C:/sourcecode/mage/')).toBe('C:/sourcecode/mage');
  });

  it('trustKey_rutaConSegmentosRelativos_losResuelve', () => {
    expect(trustKey('C:/sourcecode/otro/../mage')).toBe('C:/sourcecode/mage');
  });

  it('trustKey_rutaVacia_lanzaConElValor', () => {
    expect(() => trustKey('   ')).toThrow(/"   "/);
  });
});

describe('ancestorKeys', () => {
  it('ancestorKeys_incluyeLaCarpetaYTodosSusPadres', () => {
    const keys = ancestorKeys('C:/sourcecode/mage/src');

    expect(keys[0]).toBe('C:/sourcecode/mage/src');
    expect(keys).toContain('C:/sourcecode/mage');
    expect(keys).toContain('C:/sourcecode');
  });

  it('ancestorKeys_terminaEnLaRaiz_sinRepetirla', () => {
    const keys = ancestorKeys('C:/sourcecode/mage');

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThan(64);
  });
});

describe('isTrusted', () => {
  it('isTrusted_carpetaExacta_si', () => {
    expect(isTrusted('C:/sourcecode/mage', ['C:/sourcecode/mage'])).toBe(true);
  });

  it('isTrusted_subcarpetaDeUnaAutorizada_si', () => {
    // Autorizar un directorio de trabajo vale para los repos que cuelgan de el, igual que en el CLI.
    expect(isTrusted('C:/sourcecode/mage/src/main', ['C:/sourcecode'])).toBe(true);
  });

  it('isTrusted_carpetaPadreDeUnaAutorizada_NO', () => {
    // Al reves NO se hereda: confiar en un repo no autoriza todo lo que hay junto a el.
    expect(isTrusted('C:/sourcecode', ['C:/sourcecode/mage'])).toBe(false);
  });

  it('isTrusted_hermanaConPrefijoComun_NO', () => {
    // El borde clasico de comparar rutas por prefijo de cadena: "C:/src/mage-malo" empieza por
    // "C:/src/mage". Se compara por SEGMENTOS, asi que no cuela.
    expect(isTrusted('C:/sourcecode/mage-malo', ['C:/sourcecode/mage'])).toBe(false);
  });

  it('isTrusted_entradaGuardadaConBarrasInvertidas_si', () => {
    // Es el caso REAL: el renderer guarda la ruta tal cual la dio el selector de carpeta de Windows.
    expect(isTrusted('C:/sourcecode/mage', ['C:\\sourcecode\\mage'])).toBe(true);
  });

  it('isTrusted_mayusculasDistintas_si', () => {
    // En Windows es la misma carpeta.
    expect(isTrusted('c:/sourcecode/MAGE', ['C:/SourceCode/mage'])).toBe(true);
  });

  it('isTrusted_listaVacia_no', () => {
    expect(isTrusted('C:/sourcecode/mage', [])).toBe(false);
  });

  it('isTrusted_entradaVacia_noAutorizaNada', () => {
    // Una cadena vacia en el fichero no puede convertirse en "confia en todo".
    expect(isTrusted('C:/sourcecode/mage', ['', '   '])).toBe(false);
  });
});

describe('trustedProjectKeys', () => {
  it('trustedProjectKeys_soloLasAceptadas', () => {
    const config = {
      projects: {
        'C:/sourcecode/mage': { hasTrustDialogAccepted: true, allowedTools: [] },
        'C:/sourcecode/otro': { hasTrustDialogAccepted: false },
        'C:/sourcecode/tercero': {},
      },
    };

    expect(trustedProjectKeys(config)).toEqual(['C:/sourcecode/mage']);
  });

  it('trustedProjectKeys_valorQueNoEsBooleanoTrue_noCuenta', () => {
    // `"true"` o `1` no son `true`. Un fichero editado a mano no autoriza por parecerse.
    const config = { projects: { 'C:/a': { hasTrustDialogAccepted: 'true' }, 'C:/b': { hasTrustDialogAccepted: 1 } } };

    expect(trustedProjectKeys(config)).toEqual([]);
  });

  it('trustedProjectKeys_formasQueNoEncajan_devuelveVacio', () => {
    expect(trustedProjectKeys(null)).toEqual([]);
    expect(trustedProjectKeys([])).toEqual([]);
    expect(trustedProjectKeys({})).toEqual([]);
    expect(trustedProjectKeys({ projects: 'no' })).toEqual([]);
    expect(trustedProjectKeys({ projects: ['no'] })).toEqual([]);
  });
});

describe('readCliTrustedFolders', () => {
  it('readCliTrustedFolders_configConProyectosAceptados_losDevuelve', () => {
    const deps = {
      exists: () => true,
      readFile: () => JSON.stringify({ projects: { 'C:/sourcecode/mage': { hasTrustDialogAccepted: true } } }),
    };

    expect(readCliTrustedFolders('C:/Users/x/.claude-8', deps)).toEqual(['C:/sourcecode/mage']);
  });

  it('readCliTrustedFolders_leeElFicheroDentroDelConfigDir', () => {
    const leidos: string[] = [];
    const deps = {
      exists: () => true,
      readFile: (path: string) => {
        leidos.push(path);
        return '{}';
      },
    };

    readCliTrustedFolders('C:/Users/x/.claude-8/', deps);

    expect(leidos).toEqual(['C:/Users/x/.claude-8/.claude.json']);
  });

  it('readCliTrustedFolders_sinFichero_devuelveVacio', () => {
    const deps = {
      exists: () => false,
      readFile: () => {
        throw new Error('no deberia leerse');
      },
    };

    expect(readCliTrustedFolders('C:/Users/x/.claude-8', deps)).toEqual([]);
  });

  it('readCliTrustedFolders_jsonAMedioEscribir_devuelveVacioEnVezDeRomper', () => {
    // Pasa de verdad: el CLI reescribe ese fichero entero mientras corre. El coste de fallar aqui es
    // preguntar una vez de mas, que es el lado bueno.
    const deps = { exists: () => true, readFile: () => '{"projects": {' };

    expect(readCliTrustedFolders('C:/Users/x/.claude-8', deps)).toEqual([]);
  });
});
