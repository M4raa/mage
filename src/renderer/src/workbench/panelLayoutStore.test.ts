import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileLayoutWithRegistry } from '@shared/panelLayout';
import { PANEL_REGISTRY } from './panels/panelRegistry';
import { usePanelLayoutStore } from './panelLayoutStore';

// Un perfil nuevo: los paneles `defaultHidden` (Uso entre ellos) no están en ninguna zona.
function freshLayout() {
  return reconcileLayoutWithRegistry(null, PANEL_REGISTRY);
}

describe('panelLayoutStore — abrir un panel escondido', () => {
  const savePanelLayout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    savePanelLayout.mockClear();
    vi.stubGlobal('window', { mage: { savePanelLayout } });
    usePanelLayoutStore.setState({ layout: freshLayout() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('revealPanelById_panelEscondido_loColocaYLoAbre', () => {
    const store = usePanelLayoutStore.getState();
    expect(store.locate('usage')).toBeUndefined();

    store.revealPanelById('usage');

    const placed = usePanelLayoutStore.getState();
    expect(placed.locate('usage')).toEqual({ anchor: 'left', zone: 'b' });
    expect(placed.isPanelOpen('usage')).toBe(true);
    expect(placed.layout.hiddenPanelIds).not.toContain('usage');
    expect(savePanelLayout).toHaveBeenCalledOnce();
  });

  it('togglePanelById_panelEscondido_loColocaYLoAbre', () => {
    usePanelLayoutStore.getState().togglePanelById('permissions');

    const placed = usePanelLayoutStore.getState();
    expect(placed.locate('permissions')).toEqual({ anchor: 'right', zone: 'a' });
    expect(placed.isPanelOpen('permissions')).toBe(true);
    expect(savePanelLayout).toHaveBeenCalledOnce();
  });
});
