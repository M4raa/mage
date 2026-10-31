// Filtro de URLs del navegador aislado: solo http, https y localhost.
// Todo lo demás (file:, chrome:, devtools:, javascript:, data:, about:…) se deniega.

export const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// «localhost» o «localhost:<puerto>» escrito sin esquema; `new URL` lo leería como esquema `localhost:`.
const BARE_LOCALHOST = /^localhost(:\d{1,5})?(\/.*)?$/i;

/**
 * Normaliza lo que escribe el usuario en la barra de direcciones y lo valida.
 * Lanza Error con el valor recibido si está vacío, no es una URL o su esquema no está permitido.
 */
export function normalizeNavigationUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`URL vacía: «${raw}»`);
  }
  const candidate = BARE_LOCALHOST.test(trimmed) ? `http://${trimmed}` : trimmed;
  if (!URL.canParse(candidate)) {
    throw new Error(`URL no válida: «${raw}»`);
  }
  const parsed = new URL(candidate);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Esquema no permitido en el navegador de Mage: «${parsed.protocol}» (${raw})`);
  }
  return parsed.href;
}

/**
 * Decide si una URL absoluta que da Chromium (will-navigate, will-redirect, setWindowOpenHandler)
 * puede cargarse. No normaliza localhost sin esquema: esas URL ya llegan absolutas.
 */
export function isAllowedNavigationUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
}
