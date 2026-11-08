import { open, readdir, stat } from 'node:fs/promises';

// Recorrido de respaldo cuando la carpeta no es un repo de git (o git falla). Con las deps de fs
// inyectadas para probarlo sin disco.
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', '.next', '.venv', '__pycache__', 'target',
]);

export interface WalkEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface WalkDeps {
  readonly readdir: (absDir: string) => Promise<readonly WalkEntry[]>;
  // Una carpeta que no se puede leer (permisos) se salta; quien llama decide si lo deja escrito.
  readonly onUnreadable: (absDir: string, err: unknown) => void;
}

// Rutas relativas con `/`, en anchura, hasta `maxFiles`. No entra en enlaces simbolicos ni en las
// carpetas ignoradas, y los ficheros que son enlaces tampoco se listan.
export async function walkFiles(root: string, maxFiles: number, deps: WalkDeps): Promise<string[]> {
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error(`maxFiles invalido: ${JSON.stringify(maxFiles)}`);
  const files: string[] = [];
  const pending: string[] = [''];
  for (let rel = pending.shift(); rel !== undefined && files.length < maxFiles; rel = pending.shift()) {
    const entries = await readDirectory(root, rel, deps);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const child = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) pending.push(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  return files;
}

async function readDirectory(root: string, rel: string, deps: WalkDeps): Promise<readonly WalkEntry[]> {
  const abs = rel.length === 0 ? root : `${root}/${rel}`;
  try {
    return await deps.readdir(abs);
  } catch (err) {
    deps.onUnreadable(abs, err);
    return [];
  }
}

export const nodeReaddir = (absDir: string): Promise<readonly WalkEntry[]> => readdir(absDir, { withFileTypes: true });

export async function statBytes(absPath: string): Promise<{ bytes: number } | null> {
  const info = await stat(absPath).catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? null : Promise.reject(err)));
  return info === null || !info.isFile() ? null : { bytes: info.size };
}

// Los primeros `bytes` de un fichero; null si no existe.
export async function readHeadBytes(absPath: string, bytes: number): Promise<Uint8Array | null> {
  const handle = await open(absPath, 'r').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? null : Promise.reject(err)));
  if (handle === null) return null;
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
