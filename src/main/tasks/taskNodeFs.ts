// Enchufes con `node:fs` real del modo de tareas, para que `index.ts` solo cablee.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs';
import type { DeliverableFs } from './deliverableChecker';
import type { TaskStoreFs } from './taskStore';

// Solo «no existe» (o un tramo que no es carpeta) es null; cualquier otro error de E/S se relanza.
function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

// Abre y lee 1 byte: false si el SO lo niega (permisos, bloqueo). Es el contrato de `canRead`, no un error tragado.
function canReadOneByte(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return false;
  }
  try {
    readSync(fd, Buffer.alloc(1), 0, 1, 0);
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

export function nodeIsDirectory(path: string): boolean {
  return statOrNull(path)?.isDirectory() ?? false;
}

export function nodeIsFile(path: string): boolean {
  return statOrNull(path)?.isFile() ?? false;
}

export const nodeDeliverableFs: DeliverableFs = {
  stat: (path) => {
    const stats = statOrNull(path);
    return stats === null ? null : { isFile: stats.isFile(), size: stats.size, mtimeMs: stats.mtimeMs };
  },
  canRead: canReadOneByte,
};

export function nodeTaskStoreFs(warn: TaskStoreFs['warn']): TaskStoreFs {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
    rename: renameSync,
    tempSuffix: () => randomUUID(),
    removeFile: (path) => rmSync(path, { force: true }),
    mkdir: (path) => void mkdirSync(path, { recursive: true }),
    warn,
  };
}
