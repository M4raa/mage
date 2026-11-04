// El único fichero del módulo que carga Electron; no tiene test unitario (lo cubre el spike).
import { nativeImage, session, WebContentsView } from 'electron';
import type { ImageDeps } from './annotatedCapture';
import { ISOLATED_WEB_PREFERENCES } from './isolationConfig';
import type { BrowserDeps } from './isolatedBrowser';

export const electronBrowserDeps: BrowserDeps = {
  createSession: (partition) => session.fromPartition(partition),
  createView: (browserSession) =>
    new WebContentsView({ webPreferences: { ...ISOLATED_WEB_PREFERENCES, session: browserSession } }),
  now: () => new Date(),
};

export const electronImageDeps: ImageDeps = {
  fromBitmap: (data, size) => nativeImage.createFromBitmap(data, size),
};
