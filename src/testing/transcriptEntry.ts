import type { TranscriptEntry } from '@shared/transcripts';

// Fixture compartida de tests (Fase 7.11). Este literal de 11 campos estaba clonado en **seis**
// ficheros de test, y ninguna copia decia nada distinto: cambiaban dos campos y el resto era ruido.
//
// Lo que NO se unifica, y es deliberado: las ~15 funciones `deps()` de cada modulo. Esas no son
// duplicacion, son el patron de inyeccion de dependencias bien aplicado, y son la razon de que
// `src/main` se pueda probar sin tocar el FS. Unificarlas acoplaria tests que hoy son independientes.
//
// `category` se deriva de `kind` con la MISMA regla que usaban los helpers del renderer, para que la
// migracion no cambie ni un caso; cualquier campo se puede sobreescribir, incluida ella.
export function makeEntry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  const kind = over.kind ?? 'user';
  const index = over.index ?? 0;
  return {
    index,
    uuid: `u${index}`,
    parentUuid: null,
    isSidechain: false,
    isMeta: false,
    timestampMs: null,
    category: kind === 'user' || kind === 'assistant' ? 'turn' : 'metadata',
    kind,
    summary: '',
    tokenUsage: null,
    raw: {},
    ...over,
  };
}
