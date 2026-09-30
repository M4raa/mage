// Seccion de una version en CHANGELOG.md, para el cuerpo del release de GitHub y para la puerta de
// `pnpm check`. Es .mjs porque la usa un script de node en CI, sin el pipeline de TS. El renderer lee el
// mismo fichero con su propio parser (src/renderer/src/workbench/releaseNotes.ts): los dos cortan por el
// mismo titulo `## X.Y.Z`, sin corchetes.

const VERSION_HEADING = /^## (\d+\.\d+\.\d+)(?:\s|$)/;
const SECTION_HEADING = /^## /;

// Cuerpo de la seccion de `version` (sin su titulo), recortado. Lanza si no existe o si esta vacia: un
// release sin notas es justo lo que esta puerta viene a impedir.
export function extractVersionSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.[1] === version);
  if (start < 0) throw new Error(`CHANGELOG.md no tiene seccion para la version ${JSON.stringify(version)}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => SECTION_HEADING.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  if (body.length === 0) throw new Error(`La seccion ${JSON.stringify(version)} de CHANGELOG.md esta vacia`);
  return body;
}
