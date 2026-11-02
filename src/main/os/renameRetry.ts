// Rename con reintento ante el bloqueo transitorio de Windows (H1 de la devolución 17). En Windows, sustituir un
// fichero con `rename` falla con EPERM (o EBUSY) si otro proceso lo tiene abierto en ese instante para leerlo: medido
// por dirección con dos procesos Node, el escritor falló en ~45 % de los intentos y el lector nunca. Quien lee lo tiene
// abierto microsegundos, así que unos pocos reintentos cortos bastan. Es síncrono porque lo son sus llamantes
// (`writeAtomic` y el latido de los locks); la espera máxima total es (RENAME_ATTEMPTS - 1) × RENAME_RETRY_DELAY_MS.

import { UserFacingError, wrapError } from '@shared/i18n/localizedText';

export const RENAME_ATTEMPTS = 5;
export const RENAME_RETRY_DELAY_MS = 10;
const TRANSIENT_RENAME_CODES: readonly string[] = ['EPERM', 'EBUSY'];

export interface RenameRetryDeps {
  readonly rename: (from: string, to: string) => void;
  readonly sleep: (ms: number) => void;
}

export function renameWithRetry(deps: RenameRetryDeps, from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    const failure = tryRename(deps, from, to);
    if (failure === null) return;
    if (attempt >= RENAME_ATTEMPTS) {
      throw new UserFacingError(wrapError('errors.os.renameFailed', { path: to, attempts: String(RENAME_ATTEMPTS) }, failure));
    }
    deps.sleep(RENAME_RETRY_DELAY_MS);
  }
}

// null = publicado. Un error transitorio se devuelve para reintentar; cualquier otro se propaga tal cual.
function tryRename(deps: RenameRetryDeps, from: string, to: string): Error | null {
  try {
    deps.rename(from, to);
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (err instanceof Error && code !== undefined && TRANSIENT_RENAME_CODES.includes(code)) return err;
    throw err;
  }
}

// Espera síncrona sin ocupar la CPU (Atomics.wait sobre un buffer que nadie despierta).
export function sleepSync(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`Espera no válida: ${ms}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
