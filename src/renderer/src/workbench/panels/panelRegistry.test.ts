import { describe, expect, it } from 'vitest';
import { findPanelDefinition, PANEL_REGISTRY } from './panelRegistry';

// Estos tests NUNCA invocan `render()`: los componentes reales usan hooks de React/Zustand y el
// entorno de vitest.config.ts es 'node' (sin DOM ni renderer) — aqui solo se verifica la FORMA del
// catalogo, no el contenido visual de cada panel.
describe('PANEL_REGISTRY', () => {
  it('panelRegistry_tieneExactamenteCatorcePaneles', () => {
    // 7 + los tres de 2.9.b (instrucciones, comandos, subagentes) + "Herramientas" + "Artifacts" +
    // "Ficheros" (2.10) + "Actividad" (P-026 3.4).
    expect(PANEL_REGISTRY).toHaveLength(14);
  });

  it('panelRegistry_catalogoV1_tieneIdsUnicos', () => {
    const ids = PANEL_REGISTRY.map((p) => p.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('panelRegistry_incluyeLosCatorceIdsEsperados', () => {
    const ids = PANEL_REGISTRY.map((p) => p.id);

    expect(ids.sort()).toEqual(
      ['activity', 'agents', 'artifacts', 'commands', 'conversations', 'context', 'files', 'instructions', 'logs', 'mcp', 'memory', 'permissions', 'tools', 'usage'].sort(),
    );
  });

  it('panelRegistry_cadaPanel_tieneAnchorYZonaValidos', () => {
    const anchors = ['left', 'right', 'bottom'];
    const zones = ['a', 'b'];

    for (const p of PANEL_REGISTRY) {
      expect(anchors).toContain(p.defaultAnchor);
      expect(zones).toContain(p.defaultZone);
    }
  });

  it('panelRegistry_cadaPanel_tieneIconoNoVacioYRenderFuncion', () => {
    for (const p of PANEL_REGISTRY) {
      expect(p.icon.length).toBeGreaterThan(0);
      expect(typeof p.render).toBe('function');
    }
  });

  it('panelRegistry_lasCincoPestanasDeHoyDelInspector_vivenEnElBordeDerecho', () => {
    const inspectorPanelIds = ['permissions', 'context', 'logs', 'memory', 'mcp'];
    const inspectorPanels = PANEL_REGISTRY.filter((p) => inspectorPanelIds.includes(p.id));

    expect(inspectorPanels).toHaveLength(5);
    for (const p of inspectorPanels) {
      expect(p.defaultAnchor).toBe('right');
    }
  });

  // Feedback del usuario (2026-08-06), tras probar en vivo el split entre right/a y right/b: vuelven
  // las cinco a compartir una unica zona (tablist sin pestañas, switch por icono — ver ZonePane.tsx);
  // right/b ("medio") queda libre para lo que el usuario decida mover ahi a mano.
  it('panelRegistry_todosLosDelInspector_compartenUnaSolaZona', () => {
    // Las cinco de siempre MAS las tres de 2.9.b MAS "Herramientas", "Artifacts" y "Ficheros": el
    // tablist del Inspector sigue siendo uno solo, y right/b se queda libre para lo que el usuario
    // mueva ahi.
    const zoneA = PANEL_REGISTRY.filter((p) => p.defaultAnchor === 'right' && p.defaultZone === 'a').map((p) => p.id);
    const zoneB = PANEL_REGISTRY.filter((p) => p.defaultAnchor === 'right' && p.defaultZone === 'b').map((p) => p.id);

    expect(zoneA.length).toBe(12);
    expect(zoneB.length).toBe(0);
  });

  it('panelRegistry_usage_vivePorDefectoEnElBordeIzquierdoZonaB', () => {
    const usage = findPanelDefinition('usage');

    expect(usage?.defaultAnchor).toBe('left');
    expect(usage?.defaultZone).toBe('b');
  });
});

describe('findPanelDefinition', () => {
  it('findPanelDefinition_idExistente_devuelveElPanel', () => {
    const found = findPanelDefinition('mcp');

    expect(found?.id).toBe('mcp');
  });

  it('findPanelDefinition_idInexistente_devuelveUndefined', () => {
    const found = findPanelDefinition('no-existe');

    expect(found).toBeUndefined();
  });
});
