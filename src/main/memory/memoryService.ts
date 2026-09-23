import { join } from 'node:path';
import type { MemoryFile } from '@shared/memory';
import { encodeProjectFolderName } from '../transcripts/transcriptPath';

// Solo lee ficheros del disco (los .md de memoria son pequeños, KB): el parseo de frontmatter y
// wikilinks vive en un módulo PURO del renderer (memoryView.ts). No conoce IPC. Dependencias
// inyectables -> testable sin FS real.
export interface MemoryDeps {
  readonly exists: (path: string) => boolean;
  readonly readdir: (dir: string) => readonly string[];
  readonly readFile: (path: string) => string;
}

const MARKDOWN_FILE_PATTERN = /\.md$/i;

// Ruta de la carpeta de memoria de un proyecto. `memory/` es una de las carpetas compartidas entre
// cuentas (como `projects/`), así que se resuelve bajo la cuenta activa. Valida accountDir no vacío
// (encodeProjectFolderName ya valida cwd); un desalineo por IPC daría si no una ruta corrupta.
export function resolveMemoryDir(accountDir: string, cwd: string): string {
  if (typeof accountDir !== 'string' || accountDir.trim().length === 0) {
    throw new Error(`accountDir invalido para resolver memoria: ${JSON.stringify(accountDir)}`);
  }
  return join(accountDir, 'projects', encodeProjectFolderName(cwd), 'memory');
}

export class MemoryService {
  constructor(private readonly deps: MemoryDeps) {}

  // Lee todos los .md de la carpeta de memoria ya resuelta. Devuelve [] si la carpeta no existe:
  // un proyecto sin memoria NO es un error (a diferencia de una transcripción que se esperaba abrir).
  read(dir: string): readonly MemoryFile[] {
    if (!this.deps.exists(dir)) return [];
    const files: MemoryFile[] = [];
    for (const fileName of this.deps.readdir(dir)) {
      if (!MARKDOWN_FILE_PATTERN.test(fileName)) continue;
      files.push({ fileName, content: this.deps.readFile(join(dir, fileName)) });
    }
    return files;
  }
}
