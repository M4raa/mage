import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPLIT_SIZE_PX,
  DEFAULT_ZONE_SIZE_PX,
  MIN_ZONE_SIZE_PX,
  PANEL_LAYOUT_VERSION,
  reconcileLayoutWithRegistry,
  resolveResize,
  type Anchor,
  type PanelLayoutState,
  type PanelPlacement,
  type ZoneKey,
  type ZoneState,
} from './panelLayout';

// Fixtures minimas de test: paneles de mentira, ajenos al catalogo real (§4.1) para que estos tests
// de logica pura no se acoplen a como evolucione el catalogo de producto. Solo se necesitan los tres
// campos que reconcileLayoutWithRegistry realmente mira (id/defaultAnchor/defaultZone) — el registro
// real del renderer (PanelDefinition, con title/icon/render) es un superset estructural de esto.
function panel(id: string, defaultAnchor: Anchor, defaultZone: ZoneKey): PanelPlacement {
  return { id, defaultAnchor, defaultZone };
}
function emptyZone(anchor: Anchor): ZoneState {
  return { panelIds: [], activePanelId: null, sizePx: DEFAULT_ZONE_SIZE_PX[anchor] };
}

describe('reconcileLayoutWithRegistry', () => {
  it('reconcileLayoutWithRegistry_loadedNull_construyeLayoutDesdeDefaultsDelRegistro', () => {
    const registry = [panel('p1', 'left', 'a'), panel('p2', 'right', 'a'), panel('p3', 'right', 'a'), panel('p4', 'bottom', 'b')];

    const result = reconcileLayoutWithRegistry(null, registry);

    expect(result.version).toBe(PANEL_LAYOUT_VERSION);
    expect(result.stripes.left.a).toEqual({ panelIds: ['p1'], activePanelId: 'p1', sizePx: DEFAULT_ZONE_SIZE_PX.left });
    expect(result.stripes.left.b).toEqual(emptyZone('left'));
    expect(result.stripes.right.a).toEqual({ panelIds: ['p2', 'p3'], activePanelId: 'p2', sizePx: DEFAULT_ZONE_SIZE_PX.right });
    expect(result.stripes.right.b).toEqual(emptyZone('right'));
    expect(result.stripes.bottom.a).toEqual(emptyZone('bottom'));
    expect(result.stripes.bottom.b).toEqual({ panelIds: ['p4'], activePanelId: 'p4', sizePx: DEFAULT_ZONE_SIZE_PX.bottom });
  });

  it('reconcileLayoutWithRegistry_registroVacio_devuelveTresStripesSinNada', () => {
    const result = reconcileLayoutWithRegistry(null, []);

    expect(result.stripes).toEqual({
      left: { a: emptyZone('left'), b: emptyZone('left'), splitPx: DEFAULT_SPLIT_SIZE_PX.left },
      right: { a: emptyZone('right'), b: emptyZone('right'), splitPx: DEFAULT_SPLIT_SIZE_PX.right },
      bottom: { a: emptyZone('bottom'), b: emptyZone('bottom'), splitPx: DEFAULT_SPLIT_SIZE_PX.bottom },
    });
  });

  it('reconcileLayoutWithRegistry_ficheroVacio_seComportaIgualQueLoadedNull', () => {
    const registry = [panel('p1', 'left', 'a')];
    const desdeNull = reconcileLayoutWithRegistry(null, registry);

    const desdeVacio = reconcileLayoutWithRegistry({} as unknown as PanelLayoutState, registry);

    expect(desdeVacio).toEqual(desdeNull);
  });

  it('reconcileLayoutWithRegistry_stripeConUnaSolaZona_laZonaAusenteSeReconstruyeDesdeRegistro', () => {
    const registry = [panel('p1', 'left', 'a'), panel('p2', 'left', 'b')];
    // `stripes.left` solo trae la zona 'a'; falta 'b' por completo (y right/bottom, la stripe entera).
    const loaded = {
      version: 1,
      stripes: { left: { a: { panelIds: ['p1'], activePanelId: 'p1', sizePx: 300 } } },
    } as unknown as PanelLayoutState;

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a).toEqual({ panelIds: ['p1'], activePanelId: 'p1', sizePx: 300 });
    expect(result.stripes.left.b).toEqual({ panelIds: ['p2'], activePanelId: 'p2', sizePx: DEFAULT_ZONE_SIZE_PX.left });
    expect(result.stripes.right).toEqual({ a: emptyZone('right'), b: emptyZone('right'), splitPx: DEFAULT_SPLIT_SIZE_PX.right });
  });

  it('reconcileLayoutWithRegistry_sizePxNegativo_seClampeaAlMinimo', () => {
    const registry = [panel('p1', 'left', 'a')];
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1'], activePanelId: 'p1', sizePx: -50 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a.sizePx).toBe(MIN_ZONE_SIZE_PX);
  });

  it('reconcileLayoutWithRegistry_sizePxCero_seClampeaAlMinimo', () => {
    const registry = [panel('p1', 'left', 'a')];
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1'], activePanelId: 'p1', sizePx: 0 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a.sizePx).toBe(MIN_ZONE_SIZE_PX);
  });

  it('reconcileLayoutWithRegistry_activePanelIdFueraDePanelIds_caeAlPrimero', () => {
    const registry = [panel('p1', 'left', 'a'), panel('p2', 'left', 'a')];
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1', 'p2'], activePanelId: 'inexistente', sizePx: 200 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a.activePanelId).toBe('p1');
  });

  it('reconcileLayoutWithRegistry_activePanelIdNullConPanelesExistentes_laZonaSigueCerrada', () => {
    const registry = [panel('p1', 'left', 'a')];
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1'], activePanelId: null, sizePx: 200 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    // null es un estado legitimo (zona cerrada a proposito): reconciliar no la reabre por su cuenta.
    expect(result.stripes.left.a.activePanelId).toBeNull();
  });

  it('reconcileLayoutWithRegistry_panelNuevoEnZonaConContenidoAbierta_seAñadeSinRobarLaActivacion', () => {
    const registry = [panel('p1', 'left', 'a'), panel('p2', 'left', 'a')]; // p2 es nuevo, no esta en loaded
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1'], activePanelId: 'p1', sizePx: 200 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a).toEqual({ panelIds: ['p1', 'p2'], activePanelId: 'p1', sizePx: 200 });
  });

  it('reconcileLayoutWithRegistry_panelNuevoEnZonaConContenidoCerrada_seAñadeYSigueCerrada', () => {
    const registry = [panel('p1', 'left', 'a'), panel('p2', 'left', 'a')];
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1'], activePanelId: null, sizePx: 200 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a).toEqual({ panelIds: ['p1', 'p2'], activePanelId: null, sizePx: 200 });
  });

  it('reconcileLayoutWithRegistry_panelNuevoEnZonaVacia_seAñadeYSeAbre', () => {
    const registry = [panel('p1', 'left', 'a')]; // p1 es nuevo; la zona en loaded esta vacia
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: [], activePanelId: null, sizePx: 200 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a).toEqual({ panelIds: ['p1'], activePanelId: 'p1', sizePx: 200 });
  });

  it('reconcileLayoutWithRegistry_panelEliminadoDelRegistro_seDescartaSinLanzarYActivaElPrimeroValido', () => {
    const registry = [panel('p1', 'left', 'a')]; // p2 ya no existe en esta version del registro
    const loaded = buildLoaded(registry, 'left', 'a', { panelIds: ['p1', 'p2'], activePanelId: 'p2', sizePx: 200 });

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.a).toEqual({ panelIds: ['p1'], activePanelId: 'p1', sizePx: 200 });
  });

  it('reconcileLayoutWithRegistry_splitPxValido_seConserva', () => {
    const registry = [panel('p1', 'left', 'a')];
    const base = reconcileLayoutWithRegistry(null, registry);
    const loaded = { ...base, stripes: { ...base.stripes, left: { ...base.stripes.left, splitPx: 350 } } };

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.splitPx).toBe(350);
  });

  it('reconcileLayoutWithRegistry_splitPxNegativo_seClampeaAlMinimo', () => {
    const registry = [panel('p1', 'left', 'a')];
    const base = reconcileLayoutWithRegistry(null, registry);
    const loaded = { ...base, stripes: { ...base.stripes, left: { ...base.stripes.left, splitPx: -20 } } };

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.splitPx).toBe(MIN_ZONE_SIZE_PX);
  });

  it('reconcileLayoutWithRegistry_splitPxAusente_caeAlDefaultDelBorde', () => {
    const registry = [panel('p1', 'left', 'a')];
    const loaded = {
      version: 1,
      stripes: { left: { a: { panelIds: ['p1'], activePanelId: 'p1', sizePx: 200 } } },
    } as unknown as PanelLayoutState;

    const result = reconcileLayoutWithRegistry(loaded, registry);

    expect(result.stripes.left.splitPx).toBe(DEFAULT_SPLIT_SIZE_PX.left);
  });
});

// Construye un `loaded` completo (las tres stripes, las dos zonas de cada una) con una sola zona
// sobrescrita — evita repetir en cada test la forma entera de PanelLayoutState.
function buildLoaded(registry: readonly PanelPlacement[], anchor: Anchor, zoneKey: ZoneKey, zone: ZoneState): PanelLayoutState {
  const base = reconcileLayoutWithRegistry(null, registry);
  return { ...base, stripes: { ...base.stripes, [anchor]: { ...base.stripes[anchor], [zoneKey]: zone } } };
}

describe('resolveResize', () => {
  it('resolveResize_arrowRight_incrementaPorStep', () => {
    expect(resolveResize(200, 'ArrowRight', 100, 400, 24)).toBe(224);
  });

  it('resolveResize_arrowDown_incrementaPorStep', () => {
    expect(resolveResize(200, 'ArrowDown', 100, 400, 24)).toBe(224);
  });

  it('resolveResize_arrowLeft_decrementaPorStep', () => {
    expect(resolveResize(200, 'ArrowLeft', 100, 400, 24)).toBe(176);
  });

  it('resolveResize_arrowUp_decrementaPorStep', () => {
    expect(resolveResize(200, 'ArrowUp', 100, 400, 24)).toBe(176);
  });

  it('resolveResize_arrowRightEnElMaximo_seQuedaEnElMaximo', () => {
    expect(resolveResize(390, 'ArrowRight', 100, 400, 24)).toBe(400);
  });

  it('resolveResize_arrowLeftEnElMinimo_seQuedaEnElMinimo', () => {
    expect(resolveResize(110, 'ArrowLeft', 100, 400, 24)).toBe(100);
  });

  it('resolveResize_home_saltaAlMinimo', () => {
    expect(resolveResize(250, 'Home', 100, 400, 24)).toBe(100);
  });

  it('resolveResize_end_saltaAlMaximo', () => {
    expect(resolveResize(250, 'End', 100, 400, 24)).toBe(400);
  });

  it('resolveResize_teclaDesconocida_noCambiaElTamaño', () => {
    expect(resolveResize(250, 'PageDown', 100, 400, 24)).toBe(250);
  });

  it('resolveResize_minMayorQueMax_lanzaError', () => {
    expect(() => resolveResize(250, 'ArrowRight', 400, 100, 24)).toThrow(/min.*400.*max.*100/);
  });
});

// Un icono de panel solo puede estar en UN sitio. Lo reporto el usuario ("se pueden duplicar iconos de
// herramientas, eso esta mal, solo puede haber uno") y la causa estaba justo aqui: la reconciliacion
// deduplicaba POR ZONA, asi que un panel movido a otro borde seguia estando en el registro con su
// `defaultZone` original y esa zona lo "reponia".
describe('reconcileLayoutWithRegistry — un icono, un sitio', () => {
  const registry = [
    { id: 'alfa', defaultAnchor: 'right', defaultZone: 'a' },
    { id: 'beta', defaultAnchor: 'right', defaultZone: 'a' },
  ] as const;

  const idsOf = (layout: ReturnType<typeof reconcileLayoutWithRegistry>): readonly string[] =>
    (['left', 'right', 'bottom'] as const).flatMap((anchor) =>
      (['a', 'b'] as const).flatMap((zone) => layout.stripes[anchor][zone].panelIds),
    );

  it('reconcile_panelMovidoAOtroBorde_noSeRepone', () => {
    // El caso exacto del reporte: `alfa` vive en el registro con defaultZone right/a, pero el usuario
    // lo movio a left/a. Antes salia en los dos.
    const guardado = buildLayout({ left: { a: ['alfa'] } });

    const ids = idsOf(reconcileLayoutWithRegistry(guardado, registry));

    expect(ids.filter((id) => id === 'alfa')).toHaveLength(1);
    expect(ids).toContain('beta');
  });

  it('reconcile_ficheroQueYaTraeElDuplicado_loSanea', () => {
    // Curacion hacia atras: quien ya tenga el layout duplicado por el bug no se queda asi para siempre.
    const guardado = buildLayout({ left: { a: ['alfa'] }, right: { a: ['alfa', 'beta'] } });

    const ids = idsOf(reconcileLayoutWithRegistry(guardado, registry));

    expect(ids.filter((id) => id === 'alfa')).toHaveLength(1);
    expect(ids.filter((id) => id === 'beta')).toHaveLength(1);
  });

  it('reconcile_duplicadoDentroDeLaMismaZona_seColapsa', () => {
    const guardado = buildLayout({ right: { a: ['alfa', 'alfa', 'beta'] } });

    expect(idsOf(reconcileLayoutWithRegistry(guardado, registry)).filter((id) => id === 'alfa')).toHaveLength(1);
  });

  it('reconcile_ganaSiempreLaMismaAparicion_yElResultadoEsEstable', () => {
    // Sin un orden fijo, dos arranques con el mismo fichero podrian dejar el icono en sitios distintos.
    const guardado = buildLayout({ left: { a: ['alfa'] }, right: { a: ['alfa'] } });

    const primera = reconcileLayoutWithRegistry(guardado, registry);
    const segunda = reconcileLayoutWithRegistry(guardado, registry);

    expect(primera.stripes.left.a.panelIds).toEqual(['alfa']);
    expect(primera.stripes.right.a.panelIds).toEqual(['beta']);
    expect(segunda).toEqual(primera);
  });

  it('reconcile_panelSinRastroYSinEscondido_seAñadeComoNuevo', () => {
    // `beta` no esta en el guardado NI en `hiddenPanelIds`: es un panel nuevo de una version posterior.
    const guardado = buildLayout({ right: { a: [] } });

    expect(idsOf(reconcileLayoutWithRegistry(guardado, registry))).toContain('beta');
  });

  it('reconcile_panelEscondido_noVuelve', () => {
    const guardado = buildLayout({ right: { a: ['alfa'] } }, ['beta']);

    const result = reconcileLayoutWithRegistry(guardado, registry);

    expect(idsOf(result)).not.toContain('beta');
    expect(result.hiddenPanelIds).toEqual(['beta']);
  });

  it('reconcile_panelMovidoAZonaPosterior_noSeRepone', () => {
    // Bug 1 del punto 29: `alfa` (right/a por defecto) movido a bottom/b, una zona POSTERIOR en el
    // recorrido. Con una sola pasada, right/a lo reponia antes de que bottom/b lo reclamara.
    const guardado = buildLayout({ bottom: { b: ['alfa'] } });

    const result = reconcileLayoutWithRegistry(guardado, registry);

    expect(result.stripes.bottom.b.panelIds).toEqual(['alfa']);
    expect(idsOf(result).filter((id) => id === 'alfa')).toHaveLength(1);
  });

  it('reconcile_escondidoQueTambienEstaEnUnaZona_ganaLaZona', () => {
    const guardado = buildLayout({ right: { a: ['alfa'] } }, ['alfa']);

    const result = reconcileLayoutWithRegistry(guardado, registry);

    expect(result.stripes.right.a.panelIds).toContain('alfa');
    expect(result.hiddenPanelIds).toEqual([]);
  });

  it('reconcile_escondidoQueYaNoExiste_sePurga', () => {
    const guardado = buildLayout({}, ['fantasma', 'beta', 'beta']);

    expect(reconcileLayoutWithRegistry(guardado, registry).hiddenPanelIds).toEqual(['beta']);
  });

  it('reconcile_ficheroSinHiddenPanelIds_loTrataComoVacio', () => {
    expect(reconcileLayoutWithRegistry(buildLayout({}), registry).hiddenPanelIds).toEqual([]);
  });
});

// Layout persistido minimo: solo las zonas que se nombran traen paneles, el resto van vacias.
function buildLayout(zones: Partial<Record<'left' | 'right' | 'bottom', Partial<Record<'a' | 'b', readonly string[]>>>>, hidden?: readonly string[]): never {
  const stripe = (anchor: 'left' | 'right' | 'bottom') => ({
    a: { panelIds: zones[anchor]?.a ?? [], activePanelId: null, sizePx: 300 },
    b: { panelIds: zones[anchor]?.b ?? [], activePanelId: null, sizePx: 300 },
    splitPx: 200,
  });
  return { version: 1, stripes: { left: stripe('left'), right: stripe('right'), bottom: stripe('bottom') }, hiddenPanelIds: hidden } as never;
}
