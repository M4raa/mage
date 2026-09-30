// Logica PURA de las notas de version: leer CHANGELOG.md, comparar versiones y decidir si al arrancar se
// abre la pestaña de novedades. Sin DOM ni IPC: se prueba en Vitest y la pestaña solo pinta lo que sale.

// Id reservado de la pseudo-pestaña de novedades. Vive en el arbol de paneles (`splitLayout`) pero NO
// en `tabs`: no es una conversacion, no tiene cuenta ni sesion, y por eso tampoco se persiste
// (`restoreTabs` poda del arbol cualquier id sin pestaña, asi que no sobrevive a un reinicio).
export const RELEASE_NOTES_TAB_ID = 'mage:novedades';

export interface ChangelogEntry {
  readonly version: string;
  // Lo que va tras la raya del titulo: la fecha, o «en desarrollo». '' si no hay.
  readonly label: string;
  readonly body: string;
}

// `## 0.1.2 — 2026-10-01`. Sin corchetes (el Markdown de Mage no resuelve enlaces por referencia).
const VERSION_HEADING = /^## (\d+\.\d+\.\d+)(?:\s+—\s+(.*\S))?\s*$/;
const SECTION_HEADING = /^## /;
const VERSION_PREFIX = /^(\d+)\.(\d+)\.(\d+)/;

// Corta el changelog por sus titulos de version, en el orden del fichero (la mas reciente arriba). Lo
// que va antes de la primera version (titulo, introduccion) no es de ninguna. Un `## ` que no es una
// version es un changelog mal escrito: lanza con la linea, en vez de pegar ese texto a otra version.
export function parseChangelog(markdown: string): readonly ChangelogEntry[] {
  const entries: { version: string; label: string; lines: string[] }[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!SECTION_HEADING.test(line)) {
      entries.at(-1)?.lines.push(line);
      continue;
    }
    const match = VERSION_HEADING.exec(line);
    if (match === null) throw new Error(`Titulo de version invalido en el changelog: ${JSON.stringify(line)}`);
    entries.push({ version: match[1]!, label: match[2] ?? '', lines: [] });
  }
  return entries.map(({ version, label, lines }) => ({ version, label, body: lines.join('\n').trim() }));
}

// Los tres numeros de una version. Admite sufijo (`0.2.0-beta.1` cuenta como 0.2.0): solo manda el
// numero. Lanza ante algo que no empieza por tres numeros.
function parseVersion(version: string): readonly [number, number, number] {
  const match = VERSION_PREFIX.exec(version);
  if (match === null) throw new Error(`Version ilegible: ${JSON.stringify(version)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// <0 si `a` es anterior, 0 si son la misma, >0 si es posterior. Numero a numero: 0.1.10 > 0.1.9.
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface ReleaseNotesContext {
  // `lastSeenReleaseNotesVersion` de los ajustes ('' = nunca se guardo).
  readonly lastSeen: string;
  readonly current: string;
  // El asistente de primer arranque ya se completo alguna vez.
  readonly onboardingDone: boolean;
  readonly isDev: boolean;
  readonly isMainWindow: boolean;
}

export interface ReleaseNotesDecision {
  readonly open: boolean;
  // Version que hay que guardar como vista, o null para no escribir nada.
  readonly remember: string | null;
}

const NOTHING: ReleaseNotesDecision = { open: false, remember: null };

// ¿Se abre la pestaña de novedades al arrancar? Se abre en CUALQUIER subida (parches incluidos: Mage
// solo publica 0.1.x), solo en la ventana principal, nunca en dev (comparte `userData` con la instalada y
// se pelearian escribiendo) y nunca en una instalacion nueva (encima esta el asistente). Se guarda la
// version al decidir abrir, no al cerrar la pestaña: quien cierre Mage con ella abierta no la vuelve a ver.
export function releaseNotesDecision(context: ReleaseNotesContext): ReleaseNotesDecision {
  if (!context.isMainWindow || context.isDev) return NOTHING;
  // Sin el campo: instalacion nueva (asistente pendiente) o una 0.1.0/0.1.1 que actualiza (asistente hecho).
  if (context.lastSeen === '') return { open: context.onboardingDone, remember: context.current };
  // Misma version o una BAJADA: nada, y sin bajar el valor guardado (al volver a subir se repetirian).
  if (compareVersions(context.current, context.lastSeen) <= 0) return NOTHING;
  return { open: true, remember: context.current };
}

// Version que enseña la pestaña: la pedida (desde Ajustes), si no la instalada, y si ninguna esta en
// el changelog, la mas reciente. null solo con un changelog vacio.
export function pickReleaseNotesEntry(
  entries: readonly ChangelogEntry[],
  requested: string | null,
  installed: string,
): ChangelogEntry | null {
  const byVersion = new Map(entries.map((entry) => [entry.version, entry]));
  return (requested === null ? undefined : byVersion.get(requested)) ?? byVersion.get(installed) ?? entries[0] ?? null;
}
