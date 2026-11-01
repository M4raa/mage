import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';

// Canoniza también destinos aún inexistentes por su ancestro existente. Un enlace roto NO es un
// directorio ausente: hay que seguir su destino antes de clasificarlo o permitir crear un fichero.
export function resolvedPath(target: string, remainingLinks = 40): string {
  const absolute = resolve(target);
  try {
    return realpathSync.native(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
  }
  let entry;
  try {
    entry = lstatSync(absolute, { throwIfNoEntry: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOTDIR') throw err;
  }
  if (entry?.isSymbolicLink()) {
    if (remainingLinks === 0) throw new UserFacingError(localized('errors.os.tooManyLinks'));
    return resolvedPath(resolve(dirname(absolute), readlinkSync(absolute)), remainingLinks - 1);
  }
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(resolvedPath(parent, remainingLinks), basename(absolute));
}
