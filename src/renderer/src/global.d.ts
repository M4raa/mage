import type { MageApi } from '@shared/ipc';
import type { MageDebugApi } from '@shared/debug';

// El preload expone `window.mage` (API tipada, unico contacto con el proceso main).
// `window.mageDebug` solo se cablea en desarrollo (ventana de debug); en produccion es undefined.
declare global {
  interface Window {
    readonly mage: MageApi;
    readonly mageDebug?: MageDebugApi;
  }

  // Solo lo que Mage usa de las variables de entorno de Vite (`import.meta.env.DEV` es la bandera con
  // la que se carga `devBridge.ts`). Se declara a mano en vez de referenciar `vite/client` completo:
  // `tsconfig.web.json` va con `"types": []` a proposito y esto es lo unico que hace falta.
  // `VITE_MAGE_RELEASE_NOTES_IN_DEV`: la pone `verify:gui` para medir la apertura de novedades en dev.
  interface ImportMeta {
    readonly env: { readonly DEV: boolean; readonly VITE_MAGE_RELEASE_NOTES_IN_DEV?: string };
  }
}

export {};
