import { describe, expect, it } from 'vitest';
import { KEYBINDING_ACTIONS } from './actionCatalog';
import { PANEL_REGISTRY } from '../panels/panelRegistry';

describe('KEYBINDING_ACTIONS — panel.toggle.<id> (I10b)', () => {
  it('generaUnaAccionPorCadaPanelSalvoConversationsYPermissions', () => {
    const panelToggleIds = KEYBINDING_ACTIONS.filter((a) => a.id.startsWith('panel.toggle.')).map((a) => a.id);
    const esperados = PANEL_REGISTRY.filter((p) => p.id !== 'conversations' && p.id !== 'permissions').map(
      (p) => `panel.toggle.${p.id}`,
    );
    expect(panelToggleIds.sort()).toEqual([...esperados].sort());
  });

  it('conversationsYPermissions_noGeneranAccionPropia_yaTienenAppToggleSidebarEInspector', () => {
    const ids = KEYBINDING_ACTIONS.map((a) => a.id);
    expect(ids).not.toContain('panel.toggle.conversations');
    expect(ids).not.toContain('panel.toggle.permissions');
    expect(ids).toContain('app.toggleSidebar');
    expect(ids).toContain('app.toggleInspector');
  });

  it('todasLasAccionesDelCatalogo_tienenIdUnico', () => {
    const ids = KEYBINDING_ACTIONS.map((a) => a.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
