// Endurecimiento del navegador aislado. SOLO tipos de Electron: este fichero no carga Electron.
import type { Session, WebContents } from 'electron';
import { isAllowedNavigationUrl } from './navigationPolicy';

/** Deniega todos los permisos y cancela toda descarga en la sesión del navegador. */
export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  // Cancela toda descarga.
  session.on('will-download', (event) => event.preventDefault());
}

/** Bloquea ventanas nuevas y navegaciones/redirecciones a esquemas no permitidos. */
export function hardenContents(contents: WebContents): void {
  // `window.open` y los enlaces `target=_blank` se deniegan SIEMPRE, aunque la URL sea http:
  // el navegador aislado nunca abre ventanas; el agente navega con `navigate`.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const blockDisallowed = (details: { url: string; preventDefault: () => void }): void => {
    if (!isAllowedNavigationUrl(details.url)) details.preventDefault();
  };
  // `loadURL` no dispara `will-navigate`; por eso `navigate()` valida antes con `normalizeNavigationUrl`.
  contents.on('will-navigate', blockDisallowed);
  contents.on('will-redirect', blockDisallowed);
}
