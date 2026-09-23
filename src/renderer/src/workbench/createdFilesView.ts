import type { Block } from './types';

// Modelo de vista del panel "Ficheros" (2.10): los ficheros que ESTA conversacion ha CREADO.
//
// Mismo criterio que `artifactView` y por el mismo motivo: la fuente son los BLOQUES del chat y no un
// registro aparte. Los bloques se hidratan desde la transcripcion al reabrir una conversacion, asi que
// la lista sale igual de completa en una conversacion viva que en una de hace un mes, y no hay nada
// nuevo que persistir ni que se pueda desincronizar del hilo.
//
// Solo `Write`, que es "crear fichero" (decision del usuario: "solo ficheros nuevos"). `Edit` modifica
// algo que ya existia y su diff ya se ve en el hilo; meterlo aqui convertiria el panel en un listado de
// todo lo que el agente ha tocado, que es otra cosa.

export interface CreatedFile {
  readonly path: string;
  // Nombre y carpeta ya separados: el panel ensena el nombre grande y la ruta pequena, y hacer esto en
  // el render obligaria a partir la ruta en dos sitios.
  readonly name: string;
  readonly dir: string;
  readonly blockId: string;
  // La escritura fallo (el `tool_result` vino con error): se lista igual pero marcado — si no, un
  // fichero que el agente creyo crear y no existe se veria como uno bueno hasta abrirlo.
  readonly failed: boolean;
}

// Separador de ruta del fichero, deducido de la propia ruta y NO de `path.sep`: esto corre en el
// renderer (sin `node:path`) y la ruta puede venir de cualquiera de los tres SO.
function splitPath(fullPath: string): { readonly dir: string; readonly name: string } {
  const cut = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  if (cut < 0) return { dir: '', name: fullPath };
  return { dir: fullPath.slice(0, cut), name: fullPath.slice(cut + 1) };
}

export function createdFileFrom(block: Block): CreatedFile | null {
  // `== null` (no `=== null`): un bloque sin el campo —uno viejo en memoria, o inyectado por el
  // harness— no puede tumbar el panel.
  if (block.kind !== 'tool' || block.tool !== 'Write' || block.filePath == null) return null;
  const trimmed = block.filePath.trim();
  if (trimmed.length === 0) return null;
  const { dir, name } = splitPath(trimmed);
  return { path: trimmed, name, dir, blockId: block.id, failed: block.isError };
}

// Todos los ficheros creados en el hilo, del mas reciente al mas antiguo (lo ultimo que ha escrito el
// agente es lo que se quiere mirar). Deduplicado por ruta: reescribir el mismo fichero deja dos
// llamadas a la tool y en la lista serian el mismo fichero dos veces — gana la ULTIMA escritura, que
// es la que dice si acabo bien.
export function createdFilesOf(blocks: readonly Block[]): readonly CreatedFile[] {
  const byPath = new Map<string, CreatedFile>();
  for (const block of blocks) {
    const file = createdFileFrom(block);
    if (file === null) continue;
    // El `delete` no es adorno: un `Map` conserva el sitio de la PRIMERA insercion de cada clave, asi
    // que re-escribir un fichero actualizaba el valor pero lo dejaba donde estaba — el `reverse()` de
    // abajo lo ordenaba por primera escritura y el fichero recien tocado salia el ultimo.
    byPath.delete(file.path);
    byPath.set(file.path, file);
  }
  return [...byPath.values()].reverse();
}
