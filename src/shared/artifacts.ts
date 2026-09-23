// Reconocimiento de una publicacion de artifact (2.4). UN SOLO SITIO decide que es un artifact: lo usan
// el renderer (para pintar la tarjeta y registrar el indice) y `main` (para validar la URL antes de
// abrir una ventana). PURO: datos -> datos.
//
// MEDIDO en transcripciones reales del usuario (no deducido del fuente):
//   tool_use    -> {"name":"Artifact","input":{"file_path":"…\\informe.html","favicon":"📦",
//                   "title":"Packaging — informe previo","description":"Análisis previo…"}}
//   tool_result -> "Published C:\\…\\informe.html at https://claude.ai/code/artifact/477497ff-…\n\n
//                   Warning: The document's own <title> … was not applied"
//
// La URL se saca del TEXTO del resultado y no del `toolUseResult` estructurado (que en la transcripcion
// tambien la trae, con `{url, path, title, updated, version}`) porque el texto es el denominador comun
// de las dos rutas: en vivo, el bloque de tool solo recibe el texto aplanado.
//
// La tool NO siempre esta disponible en una sesion (medido: no aparecia entre las 79 tools de la sonda
// con haiku y si en las sesiones reales del usuario), asi que la UI no asume que exista: si nunca llega
// un tool_result asi, no hay tarjeta y no se promete nada.

// Solo https y solo claude.ai/code/artifact/<id>. Mismo criterio que `isHttpsUrl` en la frontera de
// `OpenExternal`: una URL de otro host abriria una ventana con sesion de la cuenta en un sitio ajeno.
export const ARTIFACT_URL_PATTERN = /^https:\/\/claude\.ai\/code\/artifact\/[A-Za-z0-9-]+$/;

// Nombre de la tool que publica artifacts.
export const ARTIFACT_TOOL_NAME = 'Artifact';

// Lo que se sabe del artifact ANTES de publicarse (del input de la tool). Sin `url` todavia: mientras
// la tool corre no hay nada que abrir, y una tarjeta a medias con un boton muerto es peor que la caja
// de tool normal.
export interface ArtifactDraft {
  readonly title: string;
  readonly description: string;
  readonly favicon: string;
  readonly localPath: string;
}

export interface ArtifactPublication extends ArtifactDraft {
  readonly url: string;
}

// Datos del artifact desde el INPUT de la tool. `null` si no es una publicacion de artifact.
export function parseArtifactDraft(toolName: string, input: Readonly<Record<string, unknown>>): ArtifactDraft | null {
  if (toolName !== ARTIFACT_TOOL_NAME) return null;
  const localPath = readString(input, 'file_path');
  const title = readString(input, 'title');
  return {
    // Sin `title` se cae al nombre del fichero: en la tarjeta hay que ver ALGO, y la ruta entera del
    // scratchpad no es un titulo.
    title: title.length > 0 ? title : fileNameOf(localPath),
    description: readString(input, 'description'),
    favicon: readString(input, 'favicon'),
    localPath,
  };
}

// Completa el borrador con la URL publicada, sacada del texto del `tool_result`. `null` si ese texto no
// trae ninguna URL que case el patron: entonces no hay publicacion (fallo, o un mensaje que no
// esperabamos), y se pinta la caja de tool de siempre.
export function completeArtifactPublication(draft: ArtifactDraft, resultText: string): ArtifactPublication | null {
  const url = findArtifactUrl(resultText);
  return url === null ? null : { ...draft, url };
}

// ¿Es esta URL una URL de artifact valida? La usa `main` ANTES de abrir ninguna ventana.
export function isArtifactUrl(url: string): boolean {
  return ARTIFACT_URL_PATTERN.test(url);
}

// Primera URL del texto que case el patron completo. Se recorren los "tokens que parecen URL" y se
// valida cada uno con el patron ANCLADO (`^…$`): buscar el patron suelto dentro del texto dejaria pasar
// `https://evil.example/?x=https://claude.ai/code/artifact/1`.
function findArtifactUrl(text: string): string | null {
  const candidates = text.match(/https?:\/\/[^\s"'<>)\]]+/g);
  if (candidates === null) return null;
  return candidates.find((candidate) => ARTIFACT_URL_PATTERN.test(candidate)) ?? null;
}

// Ultimo segmento de una ruta, con cualquiera de los dos separadores (Windows y POSIX).
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value.trim() : '';
}
