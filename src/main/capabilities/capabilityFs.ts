// Sistema de ficheros que necesita el registro de propiedad, síncrono a propósito: así una instalación entera corre
// sin ceder el bucle de eventos y dos operaciones de main no se intercalan. Inyectado para probarlo en memoria.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sleepSync } from '../os/renameRetry';

export interface CapabilityFs {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => Buffer;
  // Crea los directorios intermedios que falten.
  readonly writeFile: (path: string, data: Buffer) => void;
  // Rutas absolutas de todos los FICHEROS bajo `dir`, recursivo; [] si `dir` no existe.
  readonly listFiles: (dir: string) => readonly string[];
  // Renombra un fichero o un directorio entero.
  readonly rename: (from: string, to: string) => void;
  readonly removeFile: (path: string) => void;
  // Borra un fichero o un directorio con todo su contenido; no falla si no existe.
  readonly removeTree: (path: string) => void;
  // Sufijo único para los temporales de `writeAtomic`.
  readonly tempSuffix: () => string;
  readonly sleep: (ms: number) => void;
}

export function nodeCapabilityFs(): CapabilityFs {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path),
    writeFile: (path, data) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    },
    listFiles: (dir) => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name));
    },
    rename: renameSync,
    removeFile: unlinkSync,
    removeTree: (path) => rmSync(path, { recursive: true, force: true }),
    tempSuffix: () => `.${process.pid}.${randomUUID()}.tmp`,
    sleep: sleepSync,
  };
}
