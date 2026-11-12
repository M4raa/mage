// Filtro de URLs del navegador aislado: http, https, localhost y (P-040) los .html/.htm de la carpeta de la
// conversación. Todo lo demás (otros file:, chrome:, devtools:, javascript:, data:, about:…) se deniega.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FileAccess } from './fileAccess';

export const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// «localhost» o «localhost:<puerto>» escrito sin esquema; `new URL` lo leería como esquema `localhost:`.
const BARE_LOCALHOST = /^localhost(:\d{1,5})?(\/.*)?$/i;
// «C:\…» o «C:/…»: `new URL` lo leería como esquema `c:`.
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;

function toCandidate(trimmed: string): string {
  if (BARE_LOCALHOST.test(trimmed)) return `http://${trimmed}`;
  // Una ruta absoluta pegada tal cual (la de Windows en cualquier SO, para que el mensaje sea el de fichero).
  if (WINDOWS_DRIVE_PATH.test(trimmed) || path.isAbsolute(trimmed)) return pathToFileURL(trimmed).href;
  return trimmed;
}

function assertFileAllowed(href: string, raw: string, files: FileAccess | null): void {
  if (files === null) {
    throw new Error(`Esta conversación no tiene carpeta de trabajo: no se abren ficheros locales (${raw})`);
  }
  if (!files.allowsPage(href)) {
    throw new Error(`Solo se abren ficheros .html o .htm que existan dentro de la carpeta de la conversación (${files.root}): «${raw}»`);
  }
}

/**
 * Normaliza lo que escribe el usuario en la barra de direcciones (o pide el agente) y lo valida.
 * Lanza Error con el valor recibido si está vacío, no es una URL o no está permitido.
 */
export function normalizeNavigationUrl(raw: string, files: FileAccess | null): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`URL vacía: «${raw}»`);
  }
  const candidate = toCandidate(trimmed);
  if (!URL.canParse(candidate)) {
    throw new Error(`URL no válida: «${raw}»`);
  }
  const parsed = new URL(candidate);
  if (parsed.protocol === 'file:') {
    assertFileAllowed(parsed.href, raw, files);
    return parsed.href;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Esquema no permitido en el navegador de Mage: «${parsed.protocol}» (${raw})`);
  }
  return parsed.href;
}

/**
 * Decide si una URL absoluta que da Chromium (will-navigate, will-redirect) puede cargarse como página.
 * No normaliza localhost sin esquema: esas URL ya llegan absolutas.
 */
export function isAllowedNavigationUrl(url: string, files: FileAccess | null): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  if (protocol === 'file:') return files?.allowsPage(url) === true;
  return ALLOWED_PROTOCOLS.has(protocol);
}
