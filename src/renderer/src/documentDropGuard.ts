// Un enlace o un fichero soltado donde ningún componente lo recoge (barra lateral, de pestañas, cabecera) haría que
// Chromium navegase la ventana. Este oyente va en la fase de burbuja de `document`, después de los de React: quien ya
// trató el `dragover` (el chat, las zonas del dock) no se toca; lo demás no acepta el soltado (`dropEffect = 'none'`,
// que es también lo que miran los arrastres internos de pestañas y filas para saber que se soltaron fuera).
export interface DropGuardTarget {
  addEventListener(type: 'dragover' | 'drop', listener: (event: DragEvent) => void): void;
  removeEventListener(type: 'dragover' | 'drop', listener: (event: DragEvent) => void): void;
}

export function installDocumentDropGuard(target: DropGuardTarget): () => void {
  const onDragOver = (event: DragEvent): void => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (event: DragEvent): void => event.preventDefault();
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
