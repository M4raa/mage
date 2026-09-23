import type { ArtifactPublication } from '@shared/artifacts';
import type { Block } from './types';

// Modelo de vista de la tarjeta de artifact (2.4). PURO: bloque -> tarjeta (o null).
//
// Por que la tarjeta se decide AL PINTAR y no con una variante propia de `Block`: un artifact ES una
// llamada a tool, con su `tool_use` y su `tool_result`. Modelarlo aparte obligaria a duplicar el
// emparejado por `toolUseId` que ya funciona, para no ganar nada.

export interface ArtifactCard extends ArtifactPublication {
  readonly blockId: string;
}

// Tarjeta de un bloque, o `null` si ese bloque no es un artifact YA PUBLICADO. Mientras la tool corre
// no hay URL: se pinta la caja de tool de siempre, no una tarjeta con un boton muerto.
export function artifactCardFrom(block: Block): ArtifactCard | null {
  // `== null` (no `=== null`): un bloque sin el campo —uno viejo en memoria, o inyectado por el
  // harness— no puede tumbar el render del chat entero.
  if (block.kind !== 'tool' || block.artifact == null) return null;
  return { ...block.artifact, blockId: block.id };
}

// Todos los artifacts YA PUBLICADOS de un hilo, en el orden en que aparecen. Es lo que alimenta el
// panel "Artifacts": la fuente son los BLOQUES del chat, no un registro aparte, y eso no es pereza —
// los bloques se hidratan desde la transcripcion al reabrir una conversacion, asi que la lista sale
// igual de completa en una conversacion viva que en una de hace un mes, sin persistir nada nuevo.
//
// Se deduplica por URL: republicar un artifact desde la misma conversacion deja DOS llamadas a la tool
// con la misma URL, y en la lista eso seria la misma pagina dos veces. Gana la ULTIMA, que es la que
// trae el titulo y la descripcion vigentes.
export function artifactCardsOf(blocks: readonly Block[]): readonly ArtifactCard[] {
  const byUrl = new Map<string, ArtifactCard>();
  for (const block of blocks) {
    const card = artifactCardFrom(block);
    if (card !== null) byUrl.set(card.url, card);
  }
  return [...byUrl.values()];
}
