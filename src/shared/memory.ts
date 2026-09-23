// Modelo de datos de la MEMORIA persistida del CLI (~/.claude*/projects/<cwd-encoded>/memory/).
// El CLI guarda cada recuerdo como un fichero .md con frontmatter YAML-lite + cuerpo con
// `[[wikilinks]]`, más un `MEMORY.md` que es el índice mantenido a mano. main solo lee los ficheros
// crudos (son pequeños, KB); el parseo de frontmatter/wikilinks vive en un módulo PURO del renderer.

// Un fichero de memoria tal cual sale de main: nombre (con extensión) + contenido crudo. Sin parsear.
export interface MemoryFile {
  readonly fileName: string; // p.ej. "feedback_cache_immutable.md" o "MEMORY.md"
  readonly content: string;
}
