// Escritura atomica de ficheros de texto, con y sin compare-and-swap.
//
// Por que existe: Mage tenia CUATRO copias del mismo `tmp + rename` (SettingsStore, WorkspaceStore,
// PanelLayoutStore y SharedConfigService), y ninguna comprobaba si el fichero habia cambiado desde que
// se leyo. Eso es "el ultimo que escribe gana": una escritura del CLI, de otra instancia de Mage o del
// propio usuario editando a mano se pierde EN SILENCIO. Es la misma clase de fallo que costo el grupo
// G (el CLI persiste con tmp+rename), pero vista desde el lado escritor.
//
// AVISO IMPORTANTE sobre enlaces: `rename` REEMPLAZA la entrada de directorio, asi que cualquier hard
// link ajeno al fichero destino queda desenganchado. Por eso `AccountService.seedSettings` escribe
// PLANO a proposito (invariante del grupo G) y NO debe migrarse a este modulo.

// Contenido observado de un fichero. `null` significa AUSENTE, que no es lo mismo que vacio: un
// fichero que no existe y uno de 0 bytes son estados distintos para el compare-and-swap.
export type FileSnapshot = string | null;

export interface AtomicWriteDeps {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, data: string) => void;
  readonly rename: (from: string, to: string) => void;
  // Sufijo UNICO por escritura para el temporal: un nombre fijo hace que dos escrituras concurrentes se
  // pisen y el rename de una publique el fichero a medio escribir de la otra.
  readonly tempSuffix: () => string;
  // Borrado del temporal cuando NO se llega a publicar. Opcional para no romper a los llamantes que
  // solo usan `writeAtomic`; sin el, una publicacion rechazada deja el `.tmp` en el directorio.
  readonly removeFile?: (path: string) => void;
}

// Lee el estado actual del fichero. Es la foto que hay que pasarle luego a `writeAtomicIfUnchanged`.
export function readSnapshot(deps: AtomicWriteDeps, path: string): FileSnapshot {
  if (!deps.exists(path)) return null;
  return deps.readFile(path);
}

// Escritura atomica de siempre: nunca deja un fichero a medias en la ruta real. NO comprueba si algo
// cambio debajo — usar solo cuando el fichero es propiedad exclusiva de quien escribe.
export function writeAtomic(deps: AtomicWriteDeps, path: string, content: string): void {
  const tmp = tempPathFor(deps, path);
  deps.writeFile(tmp, content);
  publish(deps, tmp, path);
}

export type AtomicWriteResult =
  | { readonly status: 'written' }
  // El fichero ya no contiene lo que el llamante leyo: NO se ha escrito nada. `actual` es lo que hay
  // ahora, para que el llamante pueda releer, fusionar o avisar al usuario.
  | { readonly status: 'stale'; readonly actual: FileSnapshot };

// Escritura atomica CONDICIONAL: solo publica si el fichero sigue conteniendo exactamente `expected`.
// `expected === null` significa "lo observe ausente" (creacion); si aparecio entre medias, es stale.
//
// La comprobacion se hace DOS veces a proposito: una antes de escribir el temporal (para no escribir en
// vano ante un conflicto evidente) y otra JUSTO ANTES de publicar, que es la que cuenta.
//
// Carrera residual, dicha en voz alta: entre esa ultima lectura y el `rename` queda una ventana estrecha
// que Node no puede cerrar de forma portable (no hay un compare-and-swap de identidad de ruta). Esto
// reduce la ventana de "todo el tiempo que el usuario tuvo el editor abierto" a "unos microsegundos",
// no la elimina.
export function writeAtomicIfUnchanged(
  deps: AtomicWriteDeps,
  path: string,
  content: string,
  expected: FileSnapshot,
): AtomicWriteResult {
  const before = readSnapshot(deps, path);
  if (before !== expected) return { status: 'stale', actual: before };

  const tmp = tempPathFor(deps, path);
  deps.writeFile(tmp, content);

  const justBefore = readSnapshot(deps, path);
  if (justBefore !== expected) {
    discard(deps, tmp);
    return { status: 'stale', actual: justBefore };
  }

  publish(deps, tmp, path);
  return { status: 'written' };
}

// Mensaje de conflicto para el usuario/log. No incluye el CONTENIDO (puede ser largo o sensible):
// solo la ruta y en que se diferencia el estado, que es lo accionable.
export function describeStaleWrite(path: string, expected: FileSnapshot, actual: FileSnapshot): string {
  const was = expected === null ? 'no existia' : `tenia ${expected.length} caracteres`;
  const now = actual === null ? 'ha desaparecido' : `tiene ${actual.length} caracteres`;
  return `El fichero "${path}" cambio fuera de Mage desde que se leyo (${was}, ahora ${now}); no se ha guardado nada.`;
}

function tempPathFor(deps: AtomicWriteDeps, path: string): string {
  return `${path}.${deps.tempSuffix()}.tmp`;
}

// Publica el temporal. Si el rename falla, se intenta limpiar el temporal antes de propagar el error:
// sin esto, cada fallo dejaria un `.tmp` huerfano junto al fichero real.
function publish(deps: AtomicWriteDeps, tmp: string, path: string): void {
  try {
    deps.rename(tmp, path);
  } catch (err) {
    discard(deps, tmp);
    throw err;
  }
}

// Borra el temporal sin ruido: es limpieza, y si falla no hay nada mejor que hacer que seguir (el error
// que de verdad importa es el que provoco el descarte).
function discard(deps: AtomicWriteDeps, tmp: string): void {
  if (deps.removeFile === undefined) return;
  try {
    deps.removeFile(tmp);
  } catch {
    // Temporal huerfano: molesto, nunca corrupto. No debe tapar el error real.
  }
}
