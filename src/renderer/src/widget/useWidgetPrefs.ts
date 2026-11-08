import { useCallback, useEffect, useState } from 'react';
import type { MageApi } from '@shared/ipc';
import type { WidgetPrefs } from '@shared/widget';

type PrefsClient = Pick<MageApi, 'getWidgetPrefs' | 'onWidgetPrefs' | 'setWidgetPrefs'>;

export interface WidgetPrefsHandle {
  readonly prefs: WidgetPrefs | null; // null hasta que main responde
  readonly update: (patch: Partial<WidgetPrefs>) => void;
}

// Preferencias del widget (vista expandida y No molestar). Las guarda main: este hook solo las lee, las
// escucha y las parchea. Lo usan la ventana del widget y Ajustes.
export function useWidgetPrefs(mage: PrefsClient): WidgetPrefsHandle {
  const [prefs, setPrefs] = useState<WidgetPrefs | null>(null);

  useEffect(() => {
    const unsubscribe = mage.onWidgetPrefs(setPrefs);
    mage.getWidgetPrefs().then(setPrefs, (err: unknown) => {
      console.error('[widget] no se pudieron leer las preferencias', err);
    });
    return unsubscribe;
  }, [mage]);

  const update = useCallback(
    (patch: Partial<WidgetPrefs>): void => {
      mage.setWidgetPrefs(patch).then(setPrefs, (err: unknown) => {
        console.error('[widget] no se pudieron guardar las preferencias', err);
      });
    },
    [mage],
  );

  return { prefs, update };
}
