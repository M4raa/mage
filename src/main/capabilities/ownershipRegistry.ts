// Registro de propiedad de los ficheros que Mage escribe por su cuenta (decisión de diseño): qué ficheros
// son de qué paquete, con el hash que tenían al escribirlos. Es la única forma de borrar solo lo propio y de
// detectar colisiones antes de escribir. El esquema es ESTRICTO: es nuestro propio fichero y un registro mal leído
// acabaría borrando ficheros ajenos, así que un registro corrupto lanza y nunca se sustituye por uno vacío.
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';
import type { CapabilityFs } from './capabilityFs';
import { CAPABILITY_ENGINES, describeIssues, previewValue, type CapabilityEngine } from './capabilityPackage';

export const OWNERSHIP_SCHEMA_VERSION = 1;
export const CAPABILITIES_DIR_NAME = 'capabilities';
export const OWNERSHIP_FILE_NAME = 'ownership.json';
export const OWNERSHIP_SCOPES = ['user', 'project', 'local'] as const;
export type OwnershipScope = (typeof OWNERSHIP_SCOPES)[number];

export interface OwnershipEntry {
  readonly packageId: string;
  readonly engine: CapabilityEngine;
  readonly scope: OwnershipScope;
  readonly absPath: string;
  readonly sha256: string;
}

export interface OwnershipRegistry {
  readonly version: typeof OWNERSHIP_SCHEMA_VERSION;
  readonly entries: readonly OwnershipEntry[];
}

export const EMPTY_OWNERSHIP_REGISTRY: OwnershipRegistry = { version: OWNERSHIP_SCHEMA_VERSION, entries: [] };

const registrySchema = z.object({
  version: z.literal(OWNERSHIP_SCHEMA_VERSION),
  entries: z.array(
    z.object({
      packageId: z.string().min(1),
      engine: z.enum(CAPABILITY_ENGINES),
      scope: z.enum(OWNERSHIP_SCOPES),
      absPath: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export function ownershipRegistryPath(userDataDir: string): string {
  if (userDataDir.trim() === '' || !isAbsolute(userDataDir)) {
    throw new Error(`userData de Mage inválido para el registro de capacidades: ${JSON.stringify(userDataDir)}`);
  }
  return join(userDataDir, CAPABILITIES_DIR_NAME, OWNERSHIP_FILE_NAME);
}

export function parseOwnershipRegistry(text: string, sourcePath: string): OwnershipRegistry {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Registro de capacidades corrupto en ${sourcePath} (JSON inválido): ${previewValue(text)}`, { cause });
  }
  const result = registrySchema.safeParse(json);
  if (result.success) return result.data;
  throw new Error(`Registro de capacidades corrupto en ${sourcePath} (${describeIssues(result.error)}): ${previewValue(text)}`);
}

export function loadOwnershipRegistry(fs: CapabilityFs, path: string): OwnershipRegistry {
  // Primera vez: sin fichero no hay nada instalado. Cualquier otra cosa que no se pueda leer lanza.
  if (!fs.exists(path)) return EMPTY_OWNERSHIP_REGISTRY;
  return parseOwnershipRegistry(fs.readFile(path).toString('utf8'), path);
}

export function saveOwnershipRegistry(fs: CapabilityFs, path: string, registry: OwnershipRegistry): void {
  writeAtomic(toAtomicDeps(fs), path, JSON.stringify(registry, null, 2) + '\n');
}

function toAtomicDeps(fs: CapabilityFs): AtomicWriteDeps {
  return {
    exists: fs.exists,
    readFile: (p) => fs.readFile(p).toString('utf8'),
    writeFile: (p, d) => fs.writeFile(p, Buffer.from(d, 'utf8')),
    rename: fs.rename,
    tempSuffix: fs.tempSuffix,
    removeFile: fs.removeFile,
    sleep: fs.sleep,
  };
}
