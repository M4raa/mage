// Enlaces que un renderer intenta abrir en ventana nueva (`<a target="_blank">`, `window.open`). Sin
// manejador, Electron crea una BrowserWindow propia con esa URL: medido, un clic en un enlace del chat
// abria una segunda ventana de Mage en vez del navegador. Aqui se decide UNA vez para todas las
// ventanas: la URL va al navegador del sistema y nunca nace otra ventana.
//
// No importa `electron`: recibe el minimo contrato de `webContents` y la funcion que abre fuera, asi
// que se prueba sin Electron.

export interface WindowOpenTarget {
  readonly setWindowOpenHandler: (handler: (details: { readonly url: string }) => { readonly action: 'deny' }) => void;
}

export interface ExternalLinkDeps {
  // Abre en el navegador; LANZA si la URL no es aceptable (OpenWithService solo admite https).
  readonly openExternal: (url: string) => Promise<void>;
  readonly logError: (message: string, url: string) => void;
}

export function installExternalLinkHandler(contents: WindowOpenTarget, deps: ExternalLinkDeps): void {
  contents.setWindowOpenHandler(({ url }) => {
    // Un rechazo (http, file:, un esquema raro) se registra: el clic no hace nada, pero no en silencio.
    deps.openExternal(url).catch((err: unknown) => deps.logError(err instanceof Error ? err.message : String(err), url));
    return { action: 'deny' };
  });
}
