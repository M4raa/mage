import { classifySystemWrapper } from '@shared/systemWrappers';
import type { ChatRow } from './chatVisibility';
import type { Block } from './types';

// Respuestas de las subsesiones que Mage entrega a la creadora como mensaje (`<mage-session-result>`). Las que llegan
// SEGUIDAS se pintan en una sola línea plegada «Recibió N mensajes». PURO: una pasada sobre las filas del hilo.

type UserBlock = Extract<Block, { kind: 'user' }>;

export function isSessionResultBlock(block: Block): block is UserBlock {
  return block.kind === 'user' && classifySystemWrapper(block.text).kind === 'mage-session-result';
}

// Funde las filas `block` consecutivas que son respuestas de subsesión en UNA fila `session-results`, en el lugar de la
// primera. Cualquier otra fila (una respuesta del agente, un error…) entre dos las deja en grupos distintos.
export function groupSessionResults(rows: readonly ChatRow[]): readonly ChatRow[] {
  const grouped: ChatRow[] = [];
  for (const row of rows) {
    if (row.kind !== 'block' || !isSessionResultBlock(row.block)) {
      grouped.push(row);
      continue;
    }
    const last = grouped[grouped.length - 1];
    if (last?.kind === 'session-results') {
      grouped[grouped.length - 1] = { ...last, blocks: [...last.blocks, row.block] };
    } else {
      grouped.push({ kind: 'session-results', id: `session-results-${row.block.id}`, blocks: [row.block] });
    }
  }
  return grouped;
}
