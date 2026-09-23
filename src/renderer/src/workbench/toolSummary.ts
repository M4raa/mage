// El UNICO resumen de una llamada a herramienta y el UNICO formato de su estado (2.12.2).
//
// Habia DOS de cada, divergentes, y por eso la MISMA tool se veia distinta segun viniera del stream en
// vivo o de la transcripcion reconstruida: `engineBlocks.summarizeToolInput` no miraba el nombre de la
// tool (resumia `input.command ?? file_path ?? path ?? pattern`, o el JSON entero) mientras
// `toolView.summarizeToolInput(name, input)` si; y el estado era `exit 1 · 2.4 s` en una ruta y un
// `ok`/`error` a pelo en la otra. Un solo modulo puro, y un test que fija que las dos rutas dan lo
// mismo.

const SUMMARY_MAX_LENGTH = 120;

// Nombres del tool de subagente segun la version del CLI (`Agent` en las recientes, `Task` en otras).
export const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(['Agent', 'Task']);

// Resumen corto del input, por herramienta. Nunca lanza: es presentacion, y un input raro se resume a
// cadena vacia (la caja se pinta igual, con su nombre de tool).
export function summarizeToolInput(name: string, input: Readonly<Record<string, unknown>>): string {
  const text = toolInputText(name, input);
  return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text;
}

function toolInputText(name: string, input: Readonly<Record<string, unknown>>): string {
  if (SUBAGENT_TOOL_NAMES.has(name)) {
    const type = stringField(input, 'subagent_type');
    const description = stringField(input, 'description');
    return [type, description].filter((value) => value.length > 0).join(' · ');
  }
  if (name === 'Bash') return stringField(input, 'command');
  const filePath = stringField(input, 'file_path');
  if (filePath.length > 0) return filePath;
  const path = stringField(input, 'path');
  if (path.length > 0) return path;
  const pattern = stringField(input, 'pattern');
  if (pattern.length > 0) return pattern;
  return stringField(input, 'description');
}

export interface ToolStatus {
  readonly isError: boolean;
  readonly output: string;
  readonly durationMs: number | null;
}

// Estado de la caja: "exit N" cuando la salida lo dice (lo mas informativo que hay), si no ok/error,
// mas la duracion cuando se pudo medir. `isError` viaja aparte en el bloque: hoy habia que adivinarlo
// leyendo este texto.
export function formatToolMeta(status: ToolStatus): string {
  const exit = /Exit code (\d+)/.exec(status.output);
  const state = exit !== null ? `exit ${exit[1]}` : status.isError ? 'error' : 'ok';
  const duration = status.durationMs !== null ? ` · ${formatDuration(status.durationMs)}` : '';
  return `${state}${duration}`;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function stringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

// Herramientas cuyo texto NO es una ruta y por tanto nunca se acorta: el comando de `Bash` y la
// descripcion de un subagente son la informacion en si.
const NOT_A_PATH_TOOLS: ReadonlySet<string> = new Set(['Bash', ...SUBAGENT_TOOL_NAMES]);

// Texto CORTO para la linea plegada de una herramienta: si lo que lleva es una ruta, solo su nombre de
// fichero. La ruta entera sigue estando —en el `aria-label`, en el tooltip y en el pie del bloque
// desplegado—; lo que se evita es que una fila plegada sea 90 caracteres de carpetas y el nombre del
// fichero, que es lo unico que se busca con la vista, quede al final.
//
// Se decide por HERRAMIENTA y no por "parece una ruta": un comando de Bash como `/usr/bin/foo` tambien
// parece una ruta, y ahi el texto completo es justo lo que hace falta leer.
export function shortToolCommand(tool: string, command: string): string {
  if (NOT_A_PATH_TOOLS.has(tool)) return command;
  const clean = command.trim();
  // Separadores de los DOS mundos: la ruta viene del SO del usuario, no del de quien programa.
  const cut = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (cut < 0 || cut === clean.length - 1) return clean;
  return clean.slice(cut + 1);
}
