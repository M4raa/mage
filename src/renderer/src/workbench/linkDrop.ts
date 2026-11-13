import { isFileDrag, TAB_DRAG_MIME } from './tabActions';

// D9 (13-11): soltar un enlace sobre el prompt inserta su URL como texto. En el resto de la ventana lo sigue
// bloqueando documentDropGuard.ts (H2).
const URI_LIST_MIME = 'text/uri-list';

// Un enlace arrastrado: trae text/uri-list y no son ficheros ni una pestaña de Mage.
export function isLinkDrag(types: readonly string[]): boolean {
  return types.includes(URI_LIST_MIME) && !types.includes(TAB_DRAG_MIME) && !isFileDrag(types);
}

// La URL soltada: la primera línea de text/uri-list que no es comentario (RFC 2483). null si no hay ninguna.
export function droppedLink(getData: (format: string) => string): string | null {
  const line = getData(URI_LIST_MIME).split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.length > 0 && !entry.startsWith('#'));
  return line ?? null;
}
