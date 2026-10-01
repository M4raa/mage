import { resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';

// Lectura de un paquete de extension `.mcpb`/`.dxt` (un zip) con guardas. Todo en main: el zip es
// codigo ajeno y lo que haga falta rechazar se rechaza ANTES de escribir nada en disco.
//
// Guardas:
//  - tamaño del archivo, numero de entradas y tamaño descomprimido total (bomba de zip). fflate
//    descomprime cada entrada en un buffer del tamaño DECLARADO, asi que una entrada que mienta no
//    crece mas alla de lo sumado aqui;
//  - rutas: absolutas, con unidad, con `..`, con `:` (flujos alternativos de NTFS) o con NUL, fuera
//    (zip-slip). Se vuelven a comprobar contra la carpeta de destino al escribir (`resolveInside`);
//  - enlaces simbolicos: fflate no los interpreta, asi que un enlace del zip se escribe como un fichero
//    normal con la ruta dentro. No puede apuntar fuera.

export interface McpbLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxUnpackedBytes: number;
}

const MIB = 1024 * 1024;
export const MCPB_LIMITS: McpbLimits = { maxArchiveBytes: 256 * MIB, maxEntries: 10_000, maxUnpackedBytes: 1024 * MIB };
export const MCPB_MANIFEST = 'manifest.json';

export interface McpbContents {
  // Ruta relativa con `/` -> bytes. Sin directorios (se crean al escribir).
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly unpackedBytes: number;
}

export function readMcpb(bytes: Uint8Array, limits: McpbLimits = MCPB_LIMITS): McpbContents {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error(`El paquete ocupa ${bytes.byteLength} bytes y el máximo es ${limits.maxArchiveBytes}`);
  }
  let entries = 0;
  let declared = 0;
  const names = new Map<string, string>();
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        declared += file.originalSize;
        if (entries > limits.maxEntries) throw new Error(`El paquete tiene más de ${limits.maxEntries} entradas`);
        if (declared > limits.maxUnpackedBytes) throw new Error(`El paquete descomprimido pasa de ${limits.maxUnpackedBytes} bytes`);
        const safe = safeEntryPath(file.name);
        if (safe !== null) names.set(file.name, safe);
        return safe !== null;
      },
    });
  } catch (error) {
    throw new Error(`No se pudo leer el paquete: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files = new Map<string, Uint8Array>();
  let unpackedBytes = 0;
  for (const [name, data] of Object.entries(unzipped)) {
    const safe = names.get(name);
    if (safe === undefined) continue;
    files.set(safe, data);
    unpackedBytes += data.byteLength;
  }
  if (!files.has(MCPB_MANIFEST)) throw new Error(`El paquete no tiene ${MCPB_MANIFEST} en la raíz`);
  return { files, unpackedBytes };
}

// Ruta relativa segura de una entrada, con `/`. null = directorio (no se escribe). LANZA con la ruta
// si intenta salir de la carpeta: un paquete asi no se instala, ni siquiera en parte.
export function safeEntryPath(name: string): string | null {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.endsWith('/')) return null;
  const unsafe =
    normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0') || normalized.includes(':');
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (unsafe || segments.length === 0 || segments.includes('..')) throw new Error(`Ruta no permitida en el paquete: ${JSON.stringify(name)}`);
  return segments.join('/');
}

// Ruta absoluta de `relative` dentro de `root`, o LANZA si sale de ella. Segunda barrera, al escribir.
export function resolveInside(root: string, relative: string): string {
  const base = resolve(root);
  const target = resolve(base, ...relative.split('/'));
  if (!target.startsWith(`${base}${sep}`)) throw new Error(`Ruta fuera de la carpeta de la extensión: ${JSON.stringify(relative)}`);
  return target;
}
