// Endurecimiento del navegador aislado. SOLO tipos de Electron: este fichero no carga Electron.
import type { Session, WebContents } from 'electron';
import type { FileAccess } from './fileAccess';
import { isAllowedNavigationUrl } from './navigationPolicy';

const FORBIDDEN_STATUS = 403;

/** Sirve un fichero real con el `file:` de Chromium (su MIME, también para `type="module"`). */
export type ServeFile = (realPath: string) => Promise<Response>;

/** Deniega todos los permisos, cancela toda descarga y limita `file:` a la carpeta de la conversación. */
export function hardenSession(session: Session, files: FileAccess | null, serveFile: ServeFile): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  // Cancela toda descarga.
  session.on('will-download', (event) => event.preventDefault());
  // P-040: TODA petición `file:` de esta partición (página, css, js, imágenes, fetch) pasa por aquí (medido en
  // spike/browser-file-spike.cjs con Electron 44.4.5). Lo de fuera de la carpeta, por ruta real, se deniega.
  session.protocol.handle('file', async (request) => {
    const real = files?.resolve(request.url) ?? null;
    if (real === null) return new Response('Fuera de la carpeta de la conversación', { status: FORBIDDEN_STATUS });
    return serveFile(real);
  });
}

/** Bloquea ventanas nuevas y navegaciones/redirecciones no permitidas. */
export function hardenContents(contents: WebContents, files: FileAccess | null): void {
  // `window.open` y los enlaces `target=_blank` se deniegan SIEMPRE, aunque la URL sea http:
  // el navegador aislado nunca abre ventanas; el agente navega con `navigate`.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const blockDisallowed = (details: { url: string; preventDefault: () => void }): void => {
    if (!isAllowedNavigationUrl(details.url, files)) details.preventDefault();
  };
  // `loadURL` no dispara `will-navigate`; por eso `navigate()` valida antes con `normalizeNavigationUrl`.
  contents.on('will-navigate', blockDisallowed);
  contents.on('will-redirect', blockDisallowed);
}
