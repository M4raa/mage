import { describe, expect, it } from 'vitest';
import { ICON_PATHS, type IconName } from './Icon';

// El set de iconos sustituye a ~70 emojis de color. Las invariantes que lo hacen funcionar no son
// estéticas: si un trazo se sale de la rejilla o alguien codifica un color, el icono deja de conmutar
// con el tema y vuelve el problema que este set vino a resolver.

describe('ICON_PATHS', () => {
  const names = Object.keys(ICON_PATHS) as IconName[];

  it('paths_todos_noEstanVacios', () => {
    const vacios = names.filter((name) => ICON_PATHS[name].trim().length === 0);

    expect(vacios).toEqual([]);
  });

  it('paths_todos_empiezanPorMoveTo', () => {
    // Un `d` que no arranca con M deja el trazo colgando del punto anterior del navegador.
    const malos = names.filter((name) => !ICON_PATHS[name].trimStart().startsWith('M'));

    expect(malos).toEqual([]);
  });

  it('paths_todos_dentroDeLaRejillaDe16', () => {
    // Se comprueba la MAGNITUD, no el signo: los comandos relativos (`l`, `a`, `h`…) llevan deltas
    // negativos perfectamente validos, asi que exigir `>= 0` daria falsos positivos en casi todos los
    // iconos. Lo que esto caza es la errata real —un 160 donde iba un 16, o un 8.5 donde iba .85—,
    // que saca el trazo del viewBox y recorta el icono en pantalla.
    const fuera = names.filter((name) => {
      const numeros = ICON_PATHS[name].match(/-?\d+(\.\d+)?/g) ?? [];
      return numeros.some((texto) => Math.abs(Number(texto)) > 16.5);
    });

    expect(fuera).toEqual([]);
  });

  it('paths_ninguno_codificaUnColor', () => {
    // El color SIEMPRE lo pone quien usa el icono, via `currentColor`. Un `#rrggbb` o un `rgb(` aqui
    // dentro seria exactamente el defecto del emoji de color: no conmuta con el tema.
    const conColor = names.filter((name) => /#[0-9a-f]{3}|rgb\(|fill=/i.test(ICON_PATHS[name]));

    expect(conColor).toEqual([]);
  });

  it('paths_ninguno_seRepite', () => {
    // Dos iconos con el mismo trazo son un error de copiar y pegar: se veria el icono equivocado.
    const vistos = new Map<string, IconName>();
    const repetidos: string[] = [];
    for (const name of names) {
      const previo = vistos.get(ICON_PATHS[name]);
      if (previo !== undefined) repetidos.push(`${previo} = ${name}`);
      else vistos.set(ICON_PATHS[name], name);
    }

    expect(repetidos).toEqual([]);
  });
});
