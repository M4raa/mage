import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Las ventanas de Mage llevan un preload que da a la página todo `window.mage` (abrir rutas, escribir ficheros, ajustes).
// Si una de ellas navegara a otra página —p. ej. al soltar un enlace o un .html donde nadie recoge el `drop`—, esa página
// heredaría el preload. Solo se permite el propio renderer: en dev su origen (`ELECTRON_RENDERER_URL`), en prod los
// ficheros de su carpeta. `loadURL`/`loadFile` y `reload()` no pasan por aquí.

export interface RendererLocation {
  readonly devUrl: string | undefined;
  readonly rendererDir: string;
}

export interface NavigationEventSource {
  on(event: 'will-navigate' | 'will-redirect', listener: (details: { readonly url: string; preventDefault(): void }) => void): unknown;
}

export function isRendererUrl(url: string, location: RendererLocation): boolean {
  const target = parseUrl(url);
  if (target === null) return false;
  if (location.devUrl !== undefined && location.devUrl.length > 0) return target.origin === parseUrl(location.devUrl)?.origin;
  if (target.protocol !== 'file:') return false;
  const inside = relative(location.rendererDir, filePathOf(target) ?? location.rendererDir);
  return inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside);
}

export function installNavigationGuard(contents: NavigationEventSource, isAllowed: (url: string) => boolean, onBlocked?: (url: string) => void): void {
  const block = (details: { readonly url: string; preventDefault(): void }): void => {
    if (isAllowed(details.url)) return;
    details.preventDefault();
    onBlocked?.(details.url);
  };
  contents.on('will-navigate', block);
  contents.on('will-redirect', block);
}

// Lo único que se puede trazar de una URL soltada (es contenido del usuario): su origen.
export function originForLog(url: string): string {
  const target = parseUrl(url);
  if (target === null) return '(no es una URL)';
  return target.protocol === 'file:' ? 'file:' : target.origin;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    // No es una URL: no es un fallo tragado; para la guarda es «no es del renderer».
    return null;
  }
}

function filePathOf(target: URL): string | null {
  try {
    return fileURLToPath(target);
  } catch {
    // `file://host/…` en macOS/Linux no tiene ruta local: no es del renderer.
    return null;
  }
}
