import { describe, expect, it } from 'vitest';
import { folderChip, isInside, lastPathSegment, modelChip, privacyChip } from './chatInfoView';

// Estas etiquetas las lee el usuario de un vistazo, asi que lo que importa es que NO mientan: una ruta
// que se confunde con otra por prefijo, o un modelo que dice una version que la sesion no usa.

describe('lastPathSegment', () => {
  it('lastPathSegment_rutaDeWindows_devuelveElUltimo', () => {
    expect(lastPathSegment('C:\\sourcecode\\mage')).toBe('mage');
  });

  it('lastPathSegment_rutaPosix_tambien', () => {
    // Una ruta de WSL o escrita a mano llega con barras normales aunque el SO sea Windows.
    expect(lastPathSegment('/home/dev/proyectos/api')).toBe('api');
  });

  it('lastPathSegment_conBarraFinal_noDevuelveVacio', () => {
    expect(lastPathSegment('C:\\sourcecode\\mage\\')).toBe('mage');
  });

  it('lastPathSegment_rutaVacia_devuelveVacio', () => {
    expect(lastPathSegment('')).toBe('');
  });
});

describe('isInside', () => {
  it('isInside_subcarpeta_si', () => {
    expect(isInside('C:/tmp/scratch/aa69', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_laMismaCarpeta_si', () => {
    expect(isInside('C:/tmp/scratch', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_hermanaConPrefijoComun_NO', () => {
    // El borde de comparar rutas por prefijo de cadena: "scratch-viejo" empieza por "scratch".
    expect(isInside('C:/tmp/scratch-viejo/x', 'C:/tmp/scratch')).toBe(false);
  });

  it('isInside_separadoresMezclados_si', () => {
    expect(isInside('C:\\tmp\\scratch\\aa69', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_mayusculasDistintas_si', () => {
    expect(isInside('c:/TMP/Scratch/aa69', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_padreVacio_NO', () => {
    // Un scratch dir sin resolver no puede hacer que TODO parezca estar dentro de el.
    expect(isInside('C:/sourcecode/mage', '')).toBe(false);
  });

  it('isInside_alReves_NO', () => {
    expect(isInside('C:/tmp', 'C:/tmp/scratch')).toBe(false);
  });
});

describe('folderChip', () => {
  it('folderChip_proyectoNormal_etiquetaConElNombreDeLaCarpeta', () => {
    const chip = folderChip('C:\\sourcecode\\mage', 'C:\\tmp\\scratch');

    expect(chip).toEqual({ icon: 'folder', label: 'mage', title: 'C:\\sourcecode\\mage · abrir la carpeta' });
  });

  it('folderChip_dentroDelScratchpad_seLlamaScratchpad', () => {
    // Es el caso REAL de una conversacion "sin friccion": su cwd es un subdirectorio con nombre de
    // UUID, y ahi el ultimo segmento no dice absolutamente nada.
    const chip = folderChip('C:\\tmp\\scratch\\aa691438-9c76-4efe-97ab', 'C:\\tmp\\scratch');

    expect(chip?.label).toBe('Scratchpad');
    expect(chip?.title).toContain('aa691438');
  });

  it('folderChip_sinScratchDirResuelto_noConfundeConScratchpad', () => {
    const chip = folderChip('C:\\sourcecode\\mage', null);

    expect(chip?.label).toBe('mage');
  });

  it('folderChip_cwdVacio_devuelveNull', () => {
    // Sin carpeta no hay etiqueta: una que abriera "" no llevaria a ningun sitio.
    expect(folderChip('   ', null)).toBeNull();
  });
});

describe('modelChip', () => {
  it('modelChip_conModeloResuelto_loDiceEnElTooltip', () => {
    // Los ids de Claude son alias: la unica version que no miente es la que reporta la sesion.
    const chip = modelChip('Sonnet 5', 'claude-sonnet-5');

    expect(chip.label).toBe('Sonnet 5');
    expect(chip.title).toContain('claude-sonnet-5');
  });

  it('modelChip_sinSesionTodavia_noInventaVersion', () => {
    const chip = modelChip('Sonnet 5', null);

    expect(chip.title).toBe('Modelo Sonnet 5');
  });
});

describe('privacyChip', () => {
  it('privacyChip_privada_loDice', () => {
    expect(privacyChip('private').label).toBe('Privado');
  });

  it('privacyChip_compartida_loDice', () => {
    expect(privacyChip('shared').label).toBe('Compartido');
  });
});
