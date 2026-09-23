// Nucleo COMPARTIDO de los resolutores de binario por SO (I9): antes de este
// modulo, `claudeBinaryResolver.ts` y `agyBinaryResolver.ts` repetian a mano el mismo bucle
// "candidatas por SO -> primera que exista". Deliberadamente NO se unifica lo que SI difiere entre
// los dos (que hacer si ninguna candidata existe: Claude confia en el PATH sin comprobarlo, `agy`
// exige verificarlo de verdad porque la UI necesita poder decir "no esta instalado") — eso sigue
// siendo decision de cada resolutor, no de este modulo.

// Primera ruta de la lista que EXISTE de verdad, o null si ninguna. Puro: no decide que hacer con el
// resultado (fallback ciego, comprobar el PATH, lanzar...).
export function firstExistingPath(candidates: readonly string[], fileExists: (path: string) => boolean): string | null {
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}
