import { useEffect } from 'react';
import { useWorkbenchStore } from './workbenchStore';
import { usePanelLayoutStore } from './panelLayoutStore';

// Versión de los defaults del dock. v1: el dock derecho nace cerrado (solo la tira de iconos). Subirla vuelve a
// aplicar los defaults UNA vez por perfil; después manda el layout guardado («recuerda su último estado»).
export const DOCK_DEFAULTS_VERSION = 1;

export function shouldApplyDockDefaults(version: number): boolean {
  return version < DOCK_DEFAULTS_VERSION;
}

// Cierra las zonas del borde derecho con las acciones del store de layout (que ya persisten).
function closeRightZones(): void {
  const { layout, togglePanel } = usePanelLayoutStore.getState();
  for (const zone of ['a', 'b'] as const) {
    const active = layout.stripes.right[zone].activePanelId;
    if (active !== null) togglePanel('right', zone, active);
  }
}

// Aplica los defaults del dock en cuanto están cargados a la vez los ajustes y el layout. Una sola vez por perfil.
export function useDockDefaults(): void {
  const settingsLoaded = useWorkbenchStore((s) => s.settingsLoaded);
  const version = useWorkbenchStore((s) => s.settings.dockDefaultsVersion);
  const hydrated = usePanelLayoutStore((s) => s.hydrated);
  const setVersion = useWorkbenchStore((s) => s.setDockDefaultsVersion);
  useEffect(() => {
    if (!settingsLoaded || !hydrated || !shouldApplyDockDefaults(version)) return;
    closeRightZones();
    setVersion(DOCK_DEFAULTS_VERSION);
  }, [settingsLoaded, hydrated, version, setVersion]);
}
