import type { Block } from './types';

// Punto 14 de P-043: lo que vino después del punto rebobinado no se borra de Actividad. Se guarda aparte, con los ids
// prefijados para que nunca choquen con los de la rama vigente (los de la transcripción son deterministas).
export const DISCARDED_ID_PREFIX = 'discarded:';

// Desde la burbuja de usuario rebobinada (incluida) hasta el final. Vacío si el bloque no está.
export function discardedBranchOf(blocks: readonly Block[], userBlockId: string): readonly Block[] {
  const from = blocks.findIndex((block) => block.id === userBlockId);
  if (from < 0) return [];
  return blocks.slice(from).map((block) => ({ ...block, id: `${DISCARDED_ID_PREFIX}${block.id}` }));
}
