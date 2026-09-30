import { describe, expect, it } from 'vitest';
import { reconcileLayoutWithRegistry, type Anchor, type PanelLayoutState, type PanelPlacement, type ZoneKey } from '@shared/panelLayout';
import { allAssignedPanelIds, didZoneJustOpen, locatePanel, moveDestinations, movePanelToZone, placePanelInZone, removePanelFromLayout, reorderPanelInZone, resolveDropBeforeId, stepPanelInZone, resizeSplit, resizeZone, toggleZonePanel } from './panelLayoutOps';

function panel(id: string, defaultAnchor: Anchor, defaultZone: ZoneKey): PanelPlacement {
  return { id, defaultAnchor, defaultZone };
}

// Layout base para los tests: p1 en left/a, p2 y p3 en right/a (comparten zona, como el catalogo
// real), right/b y bottom vacios.
function baseLayout(): PanelLayoutState {
  const registry = [panel('p1', 'left', 'a'), panel('p2', 'right', 'a'), panel('p3', 'right', 'a')];
  return reconcileLayoutWithRegistry(null, registry);
}

describe('locatePanel', () => {
  it('locatePanel_panelExistente_devuelveSuAnchorYZona', () => {
    const result = locatePanel(baseLayout(), 'p2');

    expect(result).toEqual({ anchor: 'right', zone: 'a' });
  });

  it('locatePanel_panelInexistente_devuelveUndefined', () => {
    const result = locatePanel(baseLayout(), 'no-existe');

    expect(result).toBeUndefined();
  });
});

describe('removePanelFromLayout', () => {
  it('removePanelFromLayout_panelUnicoDeSuZona_laDejaVaciaYCerrada', () => {
    const result = removePanelFromLayout(baseLayout(), 'p1'); // left/a: solo p1, activo

    expect(result.stripes.left.a.panelIds).toEqual([]);
    expect(result.stripes.left.a.activePanelId).toBeNull();
    expect(allAssignedPanelIds(result).has('p1')).toBe(false);
  });

  it('removePanelFromLayout_panelActivoConHermanos_activaAlSiguiente', () => {
    const result = removePanelFromLayout(baseLayout(), 'p2'); // right/a: ['p2','p3'], activo p2

    expect(result.stripes.right.a.panelIds).toEqual(['p3']);
    expect(result.stripes.right.a.activePanelId).toBe('p3');
  });

  it('removePanelFromLayout_panelNoActivo_noCambiaElActivo', () => {
    const result = removePanelFromLayout(baseLayout(), 'p3'); // right/a: activo es p2

    expect(result.stripes.right.a.panelIds).toEqual(['p2']);
    expect(result.stripes.right.a.activePanelId).toBe('p2');
  });

  it('removePanelFromLayout_panelInexistente_devuelveElLayoutSinCambios', () => {
    const layout = baseLayout();

    expect(removePanelFromLayout(layout, 'no-existe')).toBe(layout);
  });

  it('removePanelFromLayout_dosVeces_esIdempotente', () => {
    const once = removePanelFromLayout(baseLayout(), 'p1');

    expect(removePanelFromLayout(once, 'p1')).toBe(once);
  });
});

describe('allAssignedPanelIds', () => {
  it('allAssignedPanelIds_layoutConVariosBordes_devuelveLosDeTodasLasZonas', () => {
    const result = allAssignedPanelIds(baseLayout());

    expect([...result].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('allAssignedPanelIds_panelMovidoAOtroBorde_sigueContandoComoAsignado', () => {
    // El caso del item 19: p1 pasa de left/a a right/b y NO debe reaparecer como "añadible".
    const layout = movePanelToZone(baseLayout(), 'p1', 'right', 'b');

    expect(allAssignedPanelIds(layout).has('p1')).toBe(true);
  });

  it('allAssignedPanelIds_layoutSinPaneles_devuelveConjuntoVacio', () => {
    const result = allAssignedPanelIds(reconcileLayoutWithRegistry(null, []));

    expect(result.size).toBe(0);
  });
});

describe('toggleZonePanel', () => {
  it('toggleZonePanel_zonaAbiertaConEsePanelActivo_laCierra', () => {
    const layout = baseLayout(); // left/a ya abierta con p1 activo (unico panel de la zona)

    const result = toggleZonePanel(layout, 'left', 'a', 'p1');

    expect(result.stripes.left.a.activePanelId).toBeNull();
    expect(result.stripes.left.a.panelIds).toEqual(['p1']); // sigue en la zona, solo se cierra
  });

  it('toggleZonePanel_zonaCerrada_laAbreConEsePanel', () => {
    const cerrado = toggleZonePanel(baseLayout(), 'left', 'a', 'p1'); // cierra primero

    const result = toggleZonePanel(cerrado, 'left', 'a', 'p1');

    expect(result.stripes.left.a.activePanelId).toBe('p1');
  });

  it('toggleZonePanel_otroPanelDeLaMismaZonaActivo_cambiaLaPestanaActiva', () => {
    const layout = baseLayout(); // right/a abierta con p2 activo (el primero, por defecto)

    const result = toggleZonePanel(layout, 'right', 'a', 'p3');

    expect(result.stripes.right.a.activePanelId).toBe('p3');
    expect(result.stripes.right.a.panelIds).toEqual(['p2', 'p3']); // el orden no cambia, solo el activo
  });

  it('toggleZonePanel_panelAjenoALaZona_lanzaConElIdRecibido', () => {
    expect(() => toggleZonePanel(baseLayout(), 'left', 'a', 'p2')).toThrow(/p2/);
  });
});

// §6: solo una apertura EXPLICITA de una zona antes cerrada roba el foco — ni cambiar de pestaña
// dentro de una zona ya abierta, ni cerrarla, deben hacerlo. Estos tests cubren el criterio puro que
// usa el store para decidirlo (panelLayoutStore.ts, togglePanel), sin tocar window.mage/IPC.
describe('didZoneJustOpen', () => {
  it('didZoneJustOpen_deCerradaAConUnPanelActivo_devuelveTrue', () => {
    const layout = baseLayout();
    const cerrada = toggleZonePanel(layout, 'left', 'a', 'p1'); // left/a: activo por defecto -> la cerramos

    const abierta = toggleZonePanel(cerrada, 'left', 'a', 'p1');

    expect(didZoneJustOpen(cerrada.stripes.left.a, abierta.stripes.left.a)).toBe(true);
  });

  it('didZoneJustOpen_deAbiertaACambioDePestañaDeLaMismaZona_devuelveFalse', () => {
    const layout = baseLayout(); // right/a: ['p2','p3'], activo p2

    const cambiada = toggleZonePanel(layout, 'right', 'a', 'p3');

    expect(didZoneJustOpen(layout.stripes.right.a, cambiada.stripes.right.a)).toBe(false);
  });

  it('didZoneJustOpen_deAbiertaACerrada_devuelveFalse', () => {
    const layout = baseLayout(); // left/a: abierta con p1 activo

    const cerrada = toggleZonePanel(layout, 'left', 'a', 'p1');

    expect(didZoneJustOpen(layout.stripes.left.a, cerrada.stripes.left.a)).toBe(false);
  });

  it('didZoneJustOpen_permaneceCerrada_devuelveFalse', () => {
    const cerrada = { panelIds: ['p1'], activePanelId: null, sizePx: 200 } as const;

    expect(didZoneJustOpen(cerrada, cerrada)).toBe(false);
  });
});

describe('movePanelToZone', () => {
  it('movePanelToZone_destinoVacio_saleDeOrigenYEntraActivoAlDestinoConTamañoPorDefecto', () => {
    const layout = baseLayout();

    const result = movePanelToZone(layout, 'p1', 'right', 'b');

    expect(result.stripes.left.a).toEqual({ panelIds: [], activePanelId: null, sizePx: layout.stripes.left.a.sizePx });
    expect(result.stripes.right.b.panelIds).toEqual(['p1']);
    expect(result.stripes.right.b.activePanelId).toBe('p1');
  });

  it('movePanelToZone_destinoConContenido_seAñadeAlFinalActivoYConservaElTamañoExistente', () => {
    const layout = baseLayout();
    const conTamañoPersonalizado = resizeZone(layout, 'right', 'a', 400);

    const result = movePanelToZone(conTamañoPersonalizado, 'p1', 'right', 'a');

    expect(result.stripes.right.a.panelIds).toEqual(['p2', 'p3', 'p1']);
    expect(result.stripes.right.a.activePanelId).toBe('p1');
    expect(result.stripes.right.a.sizePx).toBe(400); // no salta de tamaño por la llegada
  });

  it('movePanelToZone_origenQuedaConMasPaneles_activaElPrimeroQueQueda', () => {
    const layout = baseLayout(); // right/a: ['p2','p3'], activo p2

    const result = movePanelToZone(layout, 'p2', 'left', 'b');

    expect(result.stripes.right.a).toEqual({ panelIds: ['p3'], activePanelId: 'p3', sizePx: layout.stripes.right.a.sizePx });
  });

  it('movePanelToZone_panelInexistenteEnElLayout_lanzaConElIdRecibido', () => {
    expect(() => movePanelToZone(baseLayout(), 'no-existe', 'left', 'b')).toThrow(/no-existe/);
  });

  it('movePanelToZone_mismaZonaDeOrigenYDestino_lanza', () => {
    expect(() => movePanelToZone(baseLayout(), 'p1', 'left', 'a')).toThrow(/p1/);
  });
});

describe('resizeZone', () => {
  it('resizeZone_tamañoValido_loFijaTalCual', () => {
    const result = resizeZone(baseLayout(), 'left', 'a', 320);

    expect(result.stripes.left.a.sizePx).toBe(320);
  });

  it('resizeZone_tamañoPorDebajoDelMinimo_seClampeaAlMinimo', () => {
    const result = resizeZone(baseLayout(), 'left', 'a', 10);

    expect(result.stripes.left.a.sizePx).toBe(160); // MIN_ZONE_SIZE_PX
  });

  it('resizeZone_noAfectaOtrasZonas', () => {
    const layout = baseLayout();

    const result = resizeZone(layout, 'left', 'a', 320);

    expect(result.stripes.right.a).toEqual(layout.stripes.right.a);
    expect(result.stripes.left.b).toEqual(layout.stripes.left.b);
  });
});

describe('resizeSplit', () => {
  it('resizeSplit_tamañoValido_loFijaTalCual', () => {
    const result = resizeSplit(baseLayout(), 'right', 320);

    expect(result.stripes.right.splitPx).toBe(320);
  });

  it('resizeSplit_tamañoPorDebajoDelMinimo_seClampeaAlMinimo', () => {
    const result = resizeSplit(baseLayout(), 'right', 10);

    expect(result.stripes.right.splitPx).toBe(160); // MIN_ZONE_SIZE_PX
  });

  it('resizeSplit_noAfectaLasZonasNiOtrasStripes', () => {
    const layout = baseLayout();

    const result = resizeSplit(layout, 'right', 320);

    expect(result.stripes.right.a).toEqual(layout.stripes.right.a);
    expect(result.stripes.right.b).toEqual(layout.stripes.right.b);
    expect(result.stripes.left.splitPx).toBe(layout.stripes.left.splitPx);
  });
});

describe('moveDestinations', () => {
  it('moveDestinations_zonaActualLeftA_devuelveLasOtrasCincoSinLeftA', () => {
    const result = moveDestinations({ anchor: 'left', zone: 'a' });

    expect(result).toHaveLength(5);
    expect(result.some((d) => d.anchor === 'left' && d.zone === 'a')).toBe(false);
    expect(result).toEqual([
      { anchor: 'left', zone: 'b', label: 'Izquierda medio' },
      { anchor: 'right', zone: 'a', label: 'Derecha arriba' },
      { anchor: 'right', zone: 'b', label: 'Derecha medio' },
      { anchor: 'bottom', zone: 'a', label: 'Abajo izquierda' },
      { anchor: 'bottom', zone: 'b', label: 'Abajo derecha' },
    ]);
  });

  it('moveDestinations_zonaActualBottomB_excluyeSoloEsa', () => {
    const result = moveDestinations({ anchor: 'bottom', zone: 'b' });

    expect(result).toHaveLength(5);
    expect(result.some((d) => d.anchor === 'bottom' && d.zone === 'b')).toBe(false);
  });
});

// Layout con cuatro paneles en right/a para probar el orden: ['p2','p3','p4','p5'], activo p2.
function orderedLayout(): PanelLayoutState {
  const registry = [panel('p2', 'right', 'a'), panel('p3', 'right', 'a'), panel('p4', 'right', 'a'), panel('p5', 'right', 'a'), panel('p1', 'left', 'a')];
  return reconcileLayoutWithRegistry(null, registry);
}
const RIGHT_A = { anchor: 'right', zone: 'a' } as const;

describe('reorderPanelInZone', () => {
  it('reorderPanelInZone_alPrincipio_ponePrimero', () => {
    const result = reorderPanelInZone(orderedLayout(), 'p4', RIGHT_A, 'p2');

    expect(result.stripes.right.a.panelIds).toEqual(['p4', 'p2', 'p3', 'p5']);
  });

  it('reorderPanelInZone_enElMedio_seInsertaAntesDelDestino', () => {
    const result = reorderPanelInZone(orderedLayout(), 'p2', RIGHT_A, 'p5');

    expect(result.stripes.right.a.panelIds).toEqual(['p3', 'p4', 'p2', 'p5']);
  });

  it('reorderPanelInZone_beforeNull_vaAlFinal', () => {
    const result = reorderPanelInZone(orderedLayout(), 'p2', RIGHT_A, null);

    expect(result.stripes.right.a.panelIds).toEqual(['p3', 'p4', 'p5', 'p2']);
  });

  it('reorderPanelInZone_mismoSitio_devuelveElMismoLayout', () => {
    const layout = orderedLayout();

    expect(reorderPanelInZone(layout, 'p3', RIGHT_A, 'p4')).toBe(layout); // ya esta justo antes de p4
    expect(reorderPanelInZone(layout, 'p3', RIGHT_A, 'p3')).toBe(layout);
    expect(reorderPanelInZone(layout, 'p5', RIGHT_A, null)).toBe(layout);
  });

  it('reorderPanelInZone_noCambiaActivoNiTamaños', () => {
    const layout = orderedLayout();

    const result = reorderPanelInZone(layout, 'p4', RIGHT_A, 'p2');

    expect(result.stripes.right.a.activePanelId).toBe(layout.stripes.right.a.activePanelId);
    expect(result.stripes.right.a.sizePx).toBe(layout.stripes.right.a.sizePx);
    expect(result.stripes.left).toBe(layout.stripes.left);
  });

  it('reorderPanelInZone_panelDeOtraZona_lanzaConElId', () => {
    expect(() => reorderPanelInZone(orderedLayout(), 'p1', RIGHT_A, null)).toThrow('"p1"');
  });
});

describe('stepPanelInZone', () => {
  it('stepPanelInZone_subir_intercambiaConElAnterior', () => {
    expect(stepPanelInZone(orderedLayout(), 'p4', -1).stripes.right.a.panelIds).toEqual(['p2', 'p4', 'p3', 'p5']);
  });

  it('stepPanelInZone_bajar_intercambiaConElSiguiente', () => {
    expect(stepPanelInZone(orderedLayout(), 'p3', 1).stripes.right.a.panelIds).toEqual(['p2', 'p4', 'p3', 'p5']);
  });

  it('stepPanelInZone_enLosExtremos_esNoOp', () => {
    const layout = orderedLayout();

    expect(stepPanelInZone(layout, 'p2', -1)).toBe(layout);
    expect(stepPanelInZone(layout, 'p5', 1)).toBe(layout);
  });

  it('stepPanelInZone_panelSinZona_lanzaConElId', () => {
    expect(() => stepPanelInZone(orderedLayout(), 'nada', 1)).toThrow('"nada"');
  });
});

describe('resolveDropBeforeId', () => {
  const ids = ['p2', 'p3', 'p4'];

  it('resolveDropBeforeId_mitadSuperior_esElPropioIcono', () => {
    expect(resolveDropBeforeId(ids, 'p3', true)).toBe('p3');
  });

  it('resolveDropBeforeId_mitadInferior_esElSiguiente', () => {
    expect(resolveDropBeforeId(ids, 'p3', false)).toBe('p4');
  });

  it('resolveDropBeforeId_mitadInferiorDelUltimo_esNull', () => {
    expect(resolveDropBeforeId(ids, 'p4', false)).toBeNull();
  });

  it('resolveDropBeforeId_idDesconocido_esNull', () => {
    expect(resolveDropBeforeId(ids, 'x', true)).toBeNull();
  });
});

describe('movePanelToZone con beforeId', () => {
  it('movePanelToZone_conBeforeId_entraEnEsaPosicionDelDestino', () => {
    const result = movePanelToZone(orderedLayout(), 'p1', 'right', 'a', 'p3');

    expect(result.stripes.right.a.panelIds).toEqual(['p2', 'p1', 'p3', 'p4', 'p5']);
    expect(result.stripes.right.a.activePanelId).toBe('p1');
  });

  it('movePanelToZone_sinBeforeId_entraAlFinal', () => {
    expect(movePanelToZone(orderedLayout(), 'p1', 'right', 'a').stripes.right.a.panelIds).toEqual(['p2', 'p3', 'p4', 'p5', 'p1']);
  });

  it('movePanelToZone_beforeIdQueNoEstaEnElDestino_entraAlFinal', () => {
    expect(movePanelToZone(orderedLayout(), 'p1', 'right', 'a', 'zzz').stripes.right.a.panelIds.at(-1)).toBe('p1');
  });
});

describe('hiddenPanelIds', () => {
  it('removePanelFromLayout_panel_loAñadeAEscondidos', () => {
    expect(removePanelFromLayout(orderedLayout(), 'p3').hiddenPanelIds).toEqual(['p3']);
  });

  it('removePanelFromLayout_panelYaSinZona_noDuplicaElEscondido', () => {
    const once = removePanelFromLayout(orderedLayout(), 'p3');

    expect(removePanelFromLayout(once, 'p3').hiddenPanelIds).toEqual(['p3']);
  });

  it('placePanelInZone_panelEscondido_loQuitaDeEscondidos', () => {
    const hidden = removePanelFromLayout(orderedLayout(), 'p3');

    const result = placePanelInZone(hidden, 'p3', 'left', 'a');

    expect(result.hiddenPanelIds).toEqual([]);
    expect(result.stripes.left.a.panelIds).toContain('p3');
  });
});
