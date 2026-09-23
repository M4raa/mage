// Helpers PUROS para consumir temas de VS Code servidos por Open VSX. Sin red ni FS: se testean solos.

// Parsea JSONC (JSON con comentarios y comas colgantes) de forma tolerante: los ficheros de tema de
// VS Code suelen llevar comentarios `//` y `/* */`. El stripper es CONSCIENTE DE STRINGS (no toca `//`
// dentro de una cadena, p.ej. una URL) para no corromper valores. Lanza si el resultado no es JSON.
export function parseJsonc(text: string): unknown {
  const stripped = stripJsonComments(text);
  const withoutTrailingCommas = stripped.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(withoutTrailingCommas);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`JSON del tema no valido tras limpiar comentarios: ${detail}`);
  }
}

// Elimina comentarios de linea y de bloque respetando strings y escapes. Recorre char a char con una
// pequena maquina de estados (fuera de string / dentro de string / en comentario).
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Copia el caracter escapado tal cual (no interpretar comillas escapadas como fin de string).
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    // Fuera de string.
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}
