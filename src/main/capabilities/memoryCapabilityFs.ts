// FS en memoria para los tests del registro de propiedad y del instalador. Los directorios son implícitos: existe un
// directorio si alguna clave empieza por `resolve(dir) + sep`. Solo se usa desde tests.
import { resolve, sep } from 'node:path';
import type { CapabilityFs } from './capabilityFs';

export type FailableOp = 'writeFile' | 'rename';

export interface MemoryCapabilityFs {
  readonly fs: CapabilityFs;
  readonly files: Map<string, Buffer>;
  // La PRIMERA llamada a `op` cuya ruta contenga `pathIncludes` lanza un fallo simulado, que se consume.
  readonly failNext: (op: FailableOp, pathIncludes: string) => void;
  readonly put: (path: string, text: string) => void;
}

interface PendingFailure {
  readonly op: FailableOp;
  readonly pathIncludes: string;
}

function enoent(path: string): Error {
  return new Error(`ENOENT: ${path}`);
}

function simulatedFailure(): Error {
  // EIO a propósito: renameWithRetry reintentaría EPERM y el fallo dejaría de ser inmediato.
  return Object.assign(new Error('fallo simulado'), { code: 'EIO' });
}

export function createMemoryCapabilityFs(): MemoryCapabilityFs {
  const files = new Map<string, Buffer>();
  const failures: PendingFailure[] = [];
  let counter = 0;

  const keysUnder = (dir: string): string[] => {
    const prefix = resolve(dir) + sep;
    return [...files.keys()].filter((key) => key.startsWith(prefix));
  };

  const maybeFail = (op: FailableOp, ...paths: string[]): void => {
    const index = failures.findIndex((f) => f.op === op && paths.some((p) => p.includes(f.pathIncludes)));
    if (index === -1) return;
    failures.splice(index, 1);
    throw simulatedFailure();
  };

  const rename = (from: string, to: string): void => {
    maybeFail('rename', from, to);
    const source = resolve(from);
    const file = files.get(source);
    if (file !== undefined) {
      files.delete(source);
      files.set(resolve(to), file);
      return;
    }
    const children = keysUnder(source);
    if (children.length === 0) throw enoent(from);
    for (const key of children) {
      files.set(resolve(to) + key.slice(source.length), files.get(key) as Buffer);
      files.delete(key);
    }
  };

  const fs: CapabilityFs = {
    exists: (p) => files.has(resolve(p)) || keysUnder(p).length > 0,
    readFile: (p) => {
      const data = files.get(resolve(p));
      if (data === undefined) throw enoent(p);
      return data;
    },
    writeFile: (p, data) => {
      maybeFail('writeFile', p);
      files.set(resolve(p), Buffer.from(data));
    },
    listFiles: (dir) => keysUnder(dir),
    rename,
    removeFile: (p) => {
      if (!files.delete(resolve(p))) throw enoent(p);
    },
    removeTree: (p) => {
      files.delete(resolve(p));
      for (const key of keysUnder(p)) files.delete(key);
    },
    tempSuffix: () => `.tmp${counter++}`,
    sleep: () => undefined,
  };

  return {
    fs,
    files,
    failNext: (op, pathIncludes) => void failures.push({ op, pathIncludes }),
    put: (p, text) => void files.set(resolve(p), Buffer.from(text)),
  };
}
