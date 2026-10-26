import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { ConversationLockRef } from '@shared/conversationLock';
import { renameWithRetry, sleepSync } from '../os/renameRetry';
import type { LockFs } from './conversationLocks';

// Lo que ata los locks de conversación (#55) al sistema: dónde viven, cómo se llama cada uno, si un pid vive y el
// sistema de ficheros real. Separado del núcleo (`conversationLocks.ts`) para probar este sin disco.

export const LOCKS_DIR_NAME = 'locks';
// Perfil privado de una cuenta de Claude: es la MISMA cuenta (factura como ella), así que bloquea con su dueño.
const PRIVATE_PROFILE_DIR = 'mage-private';

// `<raíz local de Mage>/locks`: compartido por todos los perfiles (la instalada, la de desarrollo, otros) y fuera de
// todos ellos y de cualquier config dir de cuenta (H4 de la devolución 13).
export function conversationLocksDir(localMageRoot: string): string {
  return join(localMageRoot, LOCKS_DIR_NAME);
}

// Nombre del fichero: hash de (proveedor, cuenta canonizada, id nativo), para que dos cuentas no choquen. La cuenta se
// canoniza (`canonicalize`: ruta real, mayúsculas de Windows) y el perfil privado cuenta como su cuenta. Vacía = runtime
// propio, sin cuenta.
export function lockFileName(ref: ConversationLockRef, canonicalize: (path: string) => string): string {
  const owner = ref.accountDir.length === 0 ? '' : canonicalize(accountOwner(ref.accountDir));
  const hash = createHash('sha256').update(JSON.stringify([ref.provider, owner, ref.nativeId])).digest('hex').slice(0, 32);
  return `${hash}.lock`;
}

function accountOwner(accountDir: string): string {
  return basename(accountDir) === PRIVATE_PROFILE_DIR ? dirname(accountDir) : accountDir;
}

// ¿Vive ese proceso? `kill(pid, 0)` no envía nada: ESRCH = no existe; EPERM = existe pero es de otro usuario.
export function pidAliveCheck(kill: (pid: number, signal: 0) => void): (pid: number) => boolean {
  return (pid) => {
    try {
      kill(pid, 0);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      if (code === 'EPERM') return true;
      throw err;
    }
  };
}

export interface NodeLockFs {
  readonly mkdirSync: (path: string, options: { recursive: true }) => unknown;
  readonly writeFileSync: (path: string, data: string, options: { encoding: 'utf8'; flag?: string }) => void;
  readonly readFileSync: (path: string, encoding: 'utf8') => string;
  readonly renameSync: (from: string, to: string) => void;
  readonly rmSync: (path: string, options: { force: true }) => void;
  readonly statSync: (path: string) => { mtimeMs: number };
}

// `sleep`: la espera entre reintentos del rename (inyectable para los tests).
export function nodeLockFs(fs: NodeLockFs, tempSuffix: () => string, sleep: (ms: number) => void = sleepSync): LockFs {
  return {
    ensureDir: (dir) => { fs.mkdirSync(dir, { recursive: true }); },
    createExclusive: (path, content) => {
      try {
        fs.writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw err;
      }
    },
    read: (path) => ifExists(() => fs.readFileSync(path, 'utf8')),
    // En Windows el rename falla mientras la otra instancia lee el lock (H1 de la devolución 17): se reintenta, y si se
    // agota no queda el temporal.
    replace: (path, content) => {
      const temp = `${path}.${tempSuffix()}.tmp`;
      fs.writeFileSync(temp, content, { encoding: 'utf8' });
      try {
        renameWithRetry({ rename: fs.renameSync, sleep }, temp, path);
      } catch (err) {
        fs.rmSync(temp, { force: true });
        throw err;
      }
    },
    remove: (path) => { fs.rmSync(path, { force: true }); },
    mtimeMs: (path) => ifExists(() => fs.statSync(path).mtimeMs),
  };
}

// Solo «no existe» es null; cualquier otro error se propaga.
function ifExists<T>(read: () => T): T | null {
  try {
    return read();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
