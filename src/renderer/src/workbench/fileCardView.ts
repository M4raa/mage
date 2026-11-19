import { touchesOf } from './planReferences';
import type { Block } from './types';

// Ficha de un fichero creado o editado por el agente principal, en el hilo. La última escritura de la herramienta manda.
export interface FileCardView {
  readonly path: string;
  readonly name: string;
  readonly action: 'created' | 'edited';
}

export function fileCardFrom(block: Block): FileCardView | null {
  if (block.kind !== 'tool' || block.isError || block.parentToolUseId !== null) return null;
  const writes = touchesOf(block).filter((touch) => touch.action !== 'read');
  const last = writes[writes.length - 1];
  if (last === undefined || last.action === 'read') return null;
  const cut = Math.max(last.path.lastIndexOf('/'), last.path.lastIndexOf('\\'));
  return { path: last.path, name: last.path.slice(cut + 1), action: last.action };
}
