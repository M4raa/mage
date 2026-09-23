import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { SplitLayout } from '@shared/state';
import { SPLIT_LAYOUT_SCHEMA } from '@shared/stateSchema';
import {
  activateTab,
  addTabToLeaf,
  allTabIds,
  applyDrop,
  clampRatioForSize,
  closeTab,
  findLeafPath,
  firstLeafPath,
  fromLegacySplit,
  leaf,
  leafAt,
  MIN_PANE_PX,
  moveTabToLeaf,
  pruneSplitLayout,
  reconcileSplitLayoutAfterClose,
  resizeAt,
  singleLeaf,
  visibleTabIds,
  zoneFromPoint,
  type SplitDirection,
} from './splitLayout';

// Fixture de test: un nodo de division con ratio 0.5 por defecto (la unica forma de PRODUCIR un split
// en produccion es `applyDrop`, que este fichero prueba mas abajo con sus propios casos; aqui solo
// hace falta CONSTRUIR arboles para probar el resto).
function split(a: SplitLayout, b: SplitLayout, direction: SplitDirection = 'row'): SplitLayout {
  return { kind: 'split', direction, ratio: 0.5, a, b };
}

// Invariantes 1 y 2 en todas las hojas del arbol + invariante 3 (ninguna pestaña repetida).
function expectInvariants(layout: SplitLayout): void {
  const all = allTabIds(layout);
  expect(new Set(all).size).toBe(all.length);
  const walk = (node: SplitLayout): void => {
    if (node.kind === 'leaf') {
      expect(node.tabIds.length).toBeGreaterThan(0);
      expect(node.tabIds).toContain(node.activeTabId);
      return;
    }
    walk(node.a);
    walk(node.b);
  };
  walk(layout);
}

describe('leaf', () => {
  it('grupoVacio_lanza', () => {
    expect(() => leaf([], 't1')).toThrow(/vacio/);
  });

  it('activaFueraDelGrupo_lanza', () => {
    expect(() => leaf(['t1', 't2'], 't3')).toThrow(/t3/);
  });

  it('grupoValido_devuelveLaHoja', () => {
    expect(leaf(['t1', 't2'], 't2')).toEqual({ kind: 'leaf', tabIds: ['t1', 't2'], activeTabId: 't2' });
  });

  it('singleLeaf_unaSolaPestanaActiva', () => {
    expect(singleLeaf('t1')).toEqual({ kind: 'leaf', tabIds: ['t1'], activeTabId: 't1' });
  });
});

describe('visibleTabIds', () => {
  it('unGrupo_devuelveSoloLaActiva', () => {
    expect(visibleTabIds(leaf(['t1', 't2', 't3'], 't2'))).toEqual(['t2']);
  });

  it('arbolDeTresNiveles_laActivaDeCadaHojaEnOrdenDeLectura', () => {
    const layout = split(leaf(['t1', 't9'], 't1'), split(singleLeaf('t2'), singleLeaf('t3'), 'col'));
    expect(visibleTabIds(layout)).toEqual(['t1', 't2', 't3']);
  });
});

describe('allTabIds', () => {
  it('arbolConGrupos_devuelveTodasLasDeTodasLasHojas', () => {
    const layout = split(leaf(['t1', 't9'], 't1'), leaf(['t2', 't3'], 't3'));
    expect(allTabIds(layout)).toEqual(['t1', 't9', 't2', 't3']);
  });
});

describe('findLeafPath', () => {
  it('hojaRaiz_pathVacio', () => {
    expect(findLeafPath(leaf(['t1', 't2'], 't1'), 't2')).toEqual([]);
  });

  it('noPresente_null', () => {
    expect(findLeafPath(singleLeaf('t1'), 't2')).toBeNull();
  });

  it('pestanaNoActivaDeUnGrupoAnidado_devuelveElCaminoASuHoja', () => {
    const layout = split(singleLeaf('t1'), split(singleLeaf('t2'), leaf(['t3', 't4'], 't3'), 'col'));
    expect(findLeafPath(layout, 't4')).toEqual(['b', 'b']);
  });
});

describe('leafAt / firstLeafPath', () => {
  it('pathAUnaHoja_devuelveEseGrupo', () => {
    const layout = split(singleLeaf('t1'), leaf(['t2', 't3'], 't3'));
    expect(leafAt(layout, ['b'])).toEqual(leaf(['t2', 't3'], 't3'));
  });

  it('pathAUnNodoDeDivision_lanza', () => {
    expect(() => leafAt(split(singleLeaf('t1'), singleLeaf('t2')), [])).toThrow(/hoja/);
  });

  it('firstLeafPath_devuelveLaPrimeraEnOrdenDeLectura', () => {
    const layout = split(split(singleLeaf('t1'), singleLeaf('t2')), singleLeaf('t3'));
    expect(firstLeafPath(layout)).toEqual(['a', 'a']);
  });
});

describe('activateTab', () => {
  it('pestanaDeSuGrupo_laActivaSinMoverNada', () => {
    const layout = split(leaf(['t1', 't2'], 't1'), singleLeaf('t3'));
    const result = activateTab(layout, 't2');
    expect(result).toEqual(split(leaf(['t1', 't2'], 't2'), singleLeaf('t3')));
    expectInvariants(result);
  });

  it('pestanaQueNoEstaEnElArbol_mismaReferencia', () => {
    const layout = singleLeaf('t1');
    expect(activateTab(layout, 'fantasma')).toBe(layout);
  });

  it('pestanaYaActiva_mismaReferencia', () => {
    const layout = leaf(['t1', 't2'], 't2');
    expect(activateTab(layout, 't2')).toBe(layout);
  });
});

describe('closeTab', () => {
  it('unaDeVarias_seQuitaDelGrupoYLaHojaSigue', () => {
    const result = closeTab(leaf(['t1', 't2', 't3'], 't2'), 't2');
    expect(result).toEqual(leaf(['t1', 't3'], 't1'));
    expectInvariants(result!);
  });

  it('noEraLaActiva_laActivaNoCambia', () => {
    expect(closeTab(leaf(['t1', 't2', 't3'], 't3'), 't1')).toEqual(leaf(['t2', 't3'], 't3'));
  });

  it('grupoSeVaciaTeniendoHermana_laHojaColapsaYLaHermanaSube', () => {
    const layout = split(singleLeaf('t1'), leaf(['t2', 't3'], 't2'));
    expect(closeTab(layout, 't1')).toEqual(leaf(['t2', 't3'], 't2'));
  });

  it('ultimaPestanaDelArbol_null', () => {
    expect(closeTab(singleLeaf('t1'), 't1')).toBeNull();
  });

  it('noPresente_mismaReferencia', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect(closeTab(layout, 'fantasma')).toBe(layout);
  });
});

describe('addTabToLeaf', () => {
  it('pestanaNueva_entraEnEsaBarraYQuedaActiva', () => {
    const layout = split(singleLeaf('t1'), leaf(['t2', 't3'], 't2'));
    const result = addTabToLeaf(layout, ['b'], 't4');
    expect(result).toEqual(split(singleLeaf('t1'), leaf(['t2', 't3', 't4'], 't4')));
    expectInvariants(result);
  });

  it('pestanaYaEnEsaBarra_soloLaActiva', () => {
    const layout = leaf(['t1', 't2'], 't1');
    expect(addTabToLeaf(layout, [], 't2')).toEqual(leaf(['t1', 't2'], 't2'));
  });

  it('pestanaDeOtraBarra_seQuitaDeAlliPrimero_nuncaDuplicada', () => {
    const layout = split(leaf(['t1', 't2'], 't1'), singleLeaf('t3'));
    const result = addTabToLeaf(layout, ['b'], 't2');
    expect(result).toEqual(split(singleLeaf('t1'), leaf(['t3', 't2'], 't2')));
    expectInvariants(result);
  });

  it('elOrigenSeVaciaYColapsa_elDestinoSeSigueEncontrando', () => {
    const layout = split(singleLeaf('t1'), leaf(['t2', 't3'], 't2'));
    const result = addTabToLeaf(layout, ['b'], 't1'); // t1 era el unico de su hoja
    expect(result).toEqual(leaf(['t2', 't3', 't1'], 't1'));
    expectInvariants(result);
  });

  it('pathQueNoLlegaAUnaHoja_lanza', () => {
    expect(() => addTabToLeaf(singleLeaf('t1'), ['a'], 't2')).toThrow(/hoja/);
  });
});

describe('moveTabToLeaf', () => {
  it('entreBarras_mueveYActiva', () => {
    const layout = split(leaf(['t1', 't2'], 't2'), singleLeaf('t3'));
    const result = moveTabToLeaf(layout, 't2', ['b']);
    expect(result).toEqual(split(singleLeaf('t1'), leaf(['t3', 't2'], 't2')));
    expectInvariants(result);
  });
});

describe('clampRatioForSize', () => {
  it('minimoEnPixelesMasRestrictivoQueLaFraccion_acota', () => {
    // 1000px con minimo 320px -> fraccion minima 0.32 y maxima 0.68
    expect(clampRatioForSize(0.1, 1000, 320)).toBeCloseTo(0.32);
    expect(clampRatioForSize(0.95, 1000, 320)).toBeCloseTo(0.68);
  });

  it('ratioDentroDeRango_sinCambios', () => {
    expect(clampRatioForSize(0.5, 1000, 320)).toBe(0.5);
  });

  it('totalGrande_mandaElMinimoPorFraccion', () => {
    // 10000px: 320px son 0.032, mas laxo que MIN_RATIO -> se queda en 0.1/0.9
    expect(clampRatioForSize(0, 10000, 320)).toBe(0.1);
    expect(clampRatioForSize(1, 10000, 320)).toBe(0.9);
  });

  // Antes esto devolvia 0.5 fijo, y pnpm verify:gui lo cazo: en una ventana de 800 px el centro son ~406,
  // asi que el divisor se quedaba clavado y no habia forma de redimensionar. Cuando el minimo en
  // pixeles no cabe dos veces se CEDE y se acota solo por fraccion.
  // Con un contenedor que no da para dos minimos absolutos manda el suelo PROPORCIONAL: el divisor
  // conserva la mitad central de recorrido y ningun panel baja de un cuarto del espacio. Las dos
  // versiones anteriores fallaron por los extremos (0.5 fijo, o 0.1 y un panel de 57 px) y las cazo
  // el harness de GUI, no un test: por eso la de ahora se prueba en los dos sentidos.
  it('totalPequeno_elMinimoNoCabeDosVeces_acotaPorElSueloProporcional', () => {
    expect(clampRatioForSize(0.9, 500, 320)).toBe(0.75);
    expect(clampRatioForSize(0.1, 600, 320)).toBe(0.25);
    expect(clampRatioForSize(0.5, 500, 320)).toBe(0.5);
  });

  it('totalCero_soloAcotaPorFraccion', () => {
    expect(clampRatioForSize(0, 0, 320)).toBe(0.1);
    expect(clampRatioForSize(0.5, 0, 320)).toBe(0.5);
  });

  it('valoresInvalidos_lanzanConElValorRecibido', () => {
    expect(() => clampRatioForSize(Number.NaN, 1000, 320)).toThrow(/NaN/);
    expect(() => clampRatioForSize(0.5, 1000, -1)).toThrow(/-1/);
  });

  it('MIN_PANE_PX_esElMinimoQueUsaResizeAt', () => {
    expect(MIN_PANE_PX).toBe(320);
  });
});

describe('resizeAt', () => {
  it('raizEsUnNodoDeDivision_cambiaSuRatio', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect(resizeAt(layout, [], 0.3)).toMatchObject({ ratio: 0.3 });
  });

  it('sinTotalPx_seAcotaSoloAlRangoDeFraccion', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect((resizeAt(layout, [], 0) as { ratio: number }).ratio).toBe(0.1);
    expect((resizeAt(layout, [], 1) as { ratio: number }).ratio).toBe(0.9);
  });

  it('conTotalPx_seAcotaTambienPorPixeles', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect((resizeAt(layout, [], 0, 1000) as { ratio: number }).ratio).toBeCloseTo(0.32);
  });

  it('pathAUnNodoAnidado_cambiaSoloEse', () => {
    const layout = split(singleLeaf('t1'), split(singleLeaf('t2'), singleLeaf('t3'), 'col'));
    const resized = resizeAt(layout, ['b'], 0.7) as { readonly b: { readonly ratio: number } };
    expect(resized.b.ratio).toBe(0.7);
  });

  it('pathQueLlegaAUnaHoja_lanza', () => {
    expect(() => resizeAt(singleLeaf('t1'), ['a'], 0.5)).toThrow(/hoja/);
  });
});

describe('fromLegacySplit', () => {
  it('sinSplitTabId_unaSolaHoja', () => {
    expect(fromLegacySplit('t1', null, 'row')).toEqual(singleLeaf('t1'));
  });

  it('conSplitTabId_arbolDeUnNivel', () => {
    expect(fromLegacySplit('t1', 't2', 'col')).toEqual(split(singleLeaf('t1'), singleLeaf('t2'), 'col'));
  });
});

// Migracion de la forma PERSISTIDA vieja de la hoja (I11: una hoja = una pestaña) -> grupo de una.
describe('SPLIT_LAYOUT_SCHEMA', () => {
  it('hojaVieja_seMigraAGrupoDeUna', () => {
    expect(SPLIT_LAYOUT_SCHEMA.parse({ kind: 'leaf', tabId: 't1' })).toEqual(singleLeaf('t1'));
  });

  it('arbolViejoCompleto_seMigraEntero', () => {
    const persisted = {
      kind: 'split',
      direction: 'col',
      ratio: 0.4,
      a: { kind: 'leaf', tabId: 't1' },
      b: { kind: 'leaf', tabId: 't2' },
    };
    expect(SPLIT_LAYOUT_SCHEMA.parse(persisted)).toEqual({
      kind: 'split',
      direction: 'col',
      ratio: 0.4,
      a: singleLeaf('t1'),
      b: singleLeaf('t2'),
    });
  });

  it('formaNueva_sobreviveIntacta', () => {
    const layout = split(leaf(['t1', 't2'], 't2'), singleLeaf('t3'));
    expect(SPLIT_LAYOUT_SCHEMA.parse(layout)).toEqual(layout);
  });

  it('activaFueraDelGrupo_seNormalizaALaPrimera', () => {
    const parsed = SPLIT_LAYOUT_SCHEMA.parse({ kind: 'leaf', tabIds: ['t1', 't2'], activeTabId: 'fantasma' });
    expect(parsed).toEqual(leaf(['t1', 't2'], 't1'));
  });

  it('grupoVacio_noValida', () => {
    const result = SPLIT_LAYOUT_SCHEMA.safeParse({ kind: 'leaf', tabIds: [], activeTabId: '' });
    expect(result.success).toBe(false);
  });

  it('basuraQueNoEsNiUnaFormaNiOtra_noValida', () => {
    expect(SPLIT_LAYOUT_SCHEMA.safeParse({ kind: 'otra cosa' }).success).toBe(false);
    expect(z.object({ x: SPLIT_LAYOUT_SCHEMA.optional() }).parse({}).x).toBeUndefined();
  });
});

describe('reconcileSplitLayoutAfterClose', () => {
  it('pestanaCerradaNoEstabaEnElArbol_sinCambios', () => {
    const layout = singleLeaf('t1');
    expect(reconcileSplitLayoutAfterClose(layout, 'fantasma', 't1')).toBe(layout);
  });

  it('seCierraLaUnicaPestana_panelUnicoConLaNuevaActiva', () => {
    expect(reconcileSplitLayoutAfterClose(singleLeaf('t1'), 't1', 't2')).toEqual(singleLeaf('t2'));
  });

  it('laNuevaActivaSigueEnElArbol_soloSeActiva', () => {
    const layout = split(leaf(['t1', 't2'], 't1'), singleLeaf('t3'));
    expect(reconcileSplitLayoutAfterClose(layout, 't1', 't2')).toEqual(split(leaf(['t2'], 't2'), singleLeaf('t3')));
  });

  it('laNuevaActivaNoEstaba_entraEnLaBarraDeLaCerrada', () => {
    const layout = split(leaf(['t1', 't2'], 't1'), singleLeaf('t3'));
    const result = reconcileSplitLayoutAfterClose(layout, 't1', 't9');
    expect(result).toEqual(split(leaf(['t2', 't9'], 't9'), singleLeaf('t3')));
    expectInvariants(result);
  });

  it('laBarraDeLaCerradaColapsa_laNuevaActivaVaALaPrimera', () => {
    const layout = split(singleLeaf('t1'), leaf(['t2', 't3'], 't2'));
    const result = reconcileSplitLayoutAfterClose(layout, 't1', 't9');
    expect(result).toEqual(leaf(['t2', 't3', 't9'], 't9'));
    expectInvariants(result);
  });
});

describe('pruneSplitLayout', () => {
  it('todasSobreviven_sinCambios', () => {
    const layout = split(leaf(['t1', 't2'], 't2'), singleLeaf('t3'));
    expect(pruneSplitLayout(layout, new Set(['t1', 't2', 't3']))).toBe(layout);
  });

  it('unaPestanaDeUnGrupoNoSobrevive_elGrupoSigueSinElla', () => {
    const layout = split(leaf(['t1', 't2'], 't2'), singleLeaf('t3'));
    expect(pruneSplitLayout(layout, new Set(['t1', 't3']))).toEqual(split(leaf(['t1'], 't1'), singleLeaf('t3')));
  });

  it('unGrupoEnteroNoSobrevive_colapsaAlHermano', () => {
    const layout = split(leaf(['t1', 't2'], 't2'), singleLeaf('t3'));
    expect(pruneSplitLayout(layout, new Set(['t3']))).toEqual(singleLeaf('t3'));
  });

  it('ningunaSobrevive_null', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect(pruneSplitLayout(layout, new Set())).toBeNull();
  });

  it('pestanaRepetidaEnDosGrupos_seQuedaEnElPrimeroEnOrdenDeLectura', () => {
    // Estado persistido corrupto: t1 en las dos hojas. La poda hace cumplir el invariante 3.
    const layout = split(leaf(['t1', 't2'], 't1'), leaf(['t1', 't3'], 't1'));
    const result = pruneSplitLayout(layout, new Set(['t1', 't2', 't3']));
    expect(result).toEqual(split(leaf(['t1', 't2'], 't1'), leaf(['t3'], 't3')));
    expectInvariants(result!);
  });
});

// --- I11-drag: arrastrar una pestaña a un panel (estilo VS Code/IntelliJ) -----------------------

describe('zoneFromPoint', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it('centroExacto_center', () => {
    expect(zoneFromPoint(rect, 50, 50)).toBe('center');
  });

  it('dentroDeLaFranjaCentral_center', () => {
    // franja central = 40% (CENTER_HALF_WIDTH=0.2 a cada lado): 35,35 y 65,65 siguen dentro.
    expect(zoneFromPoint(rect, 35, 35)).toBe('center');
    expect(zoneFromPoint(rect, 65, 65)).toBe('center');
  });

  it('bordeIzquierdo_left', () => {
    expect(zoneFromPoint(rect, 5, 50)).toBe('left');
  });

  it('bordeDerecho_right', () => {
    expect(zoneFromPoint(rect, 95, 50)).toBe('right');
  });

  it('bordeSuperior_top', () => {
    expect(zoneFromPoint(rect, 50, 5)).toBe('top');
  });

  it('bordeInferior_bottom', () => {
    expect(zoneFromPoint(rect, 50, 95)).toBe('bottom');
  });

  it('esquina_ganaElEjeConMayorDesviacion', () => {
    // (10, 40): dx=-0.4, dy=-0.1 -> horizontal manda -> left
    expect(zoneFromPoint(rect, 10, 40)).toBe('left');
    // (40, 10): dx=-0.1, dy=-0.4 -> vertical manda -> top
    expect(zoneFromPoint(rect, 40, 10)).toBe('top');
  });

  it('rectangularNoCuadrado_usaFraccionNoPixeles', () => {
    // 200x50: a igual fraccion (0.05,0.5) que el cuadrado de arriba, debe seguir siendo 'left'.
    expect(zoneFromPoint({ left: 0, top: 0, width: 200, height: 50 }, 10, 25)).toBe('left');
  });
});

describe('applyDrop', () => {
  it('zonaCenter_laPestanaSeMueveAEseGrupo', () => {
    const layout = split(leaf(['t1', 't2'], 't1'), singleLeaf('t3'));
    const result = applyDrop(layout, 't2', ['b'], 'center');
    expect(result).toEqual(split(singleLeaf('t1'), leaf(['t3', 't2'], 't2')));
    expectInvariants(result);
  });

  it('sueltaEnLeft_elArrastradoQuedaEnAYElGrupoDestinoEnB', () => {
    const layout = leaf(['t1', 't2'], 't1');
    const result = applyDrop(layout, 't2', [], 'left');
    expect(result).toEqual(split(singleLeaf('t2'), leaf(['t1'], 't1'), 'row'));
    expectInvariants(result);
  });

  it('sueltaEnRight_elGrupoDestinoQuedaEnAYElArrastradoEnB', () => {
    const layout = leaf(['t1', 't2'], 't1');
    expect(applyDrop(layout, 't2', [], 'right')).toEqual(split(leaf(['t1'], 't1'), singleLeaf('t2'), 'row'));
  });

  it('sueltaEnTop_direccionCol_arrastradoArriba', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect(applyDrop(layout, 't1', ['b'], 'top')).toEqual(split(singleLeaf('t1'), singleLeaf('t2'), 'col'));
  });

  it('sueltaEnBottom_direccionCol_arrastradoAbajo', () => {
    const layout = split(leaf(['t1', 't9'], 't1'), singleLeaf('t2'));
    const result = applyDrop(layout, 't9', ['b'], 'bottom');
    expect(result).toEqual(split(singleLeaf('t1'), split(singleLeaf('t2'), singleLeaf('t9'), 'col')));
    expectInvariants(result);
  });

  it('elArrastradoEraElUnicoDelPanelDestino_sinCambios', () => {
    const layout = split(singleLeaf('t1'), singleLeaf('t2'));
    expect(applyDrop(layout, 't2', ['b'], 'left')).toBe(layout);
  });

  it('elArrastradoVieneDeOtroPanelQueSeVacia_esePanelColapsa', () => {
    const layout = split(singleLeaf('t1'), leaf(['t2', 't3'], 't2'));
    const result = applyDrop(layout, 't1', ['b'], 'right');
    expect(result).toEqual(split(leaf(['t2', 't3'], 't2'), singleLeaf('t1'), 'row'));
    expectInvariants(result);
  });
});
