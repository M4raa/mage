// Estado de la biblioteca (D-P2): qué paquetes instaló Mage, en qué cuenta y si están activos, con una COPIA del
// paquete instalado para poder quitarlo o restaurarlo aunque el catálogo de una versión nueva ya no lo tenga.
// El esquema es ESTRICTO, como el de ownership.json: un estado mal leído podría hacer que Mage quite algo que no
// instaló, así que uno corrupto lanza y nunca se sustituye por uno vacío.
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { writeAtomic } from '../../os/atomicFile';
import type { CapabilityFs } from '../capabilityFs';
import {
  CAPABILITY_ENGINES,
  describeIssues,
  parseCapabilityPackage,
  previewValue,
  type CapabilityEngine,
  type CapabilityPackage,
} from '../capabilityPackage';
import { CAPABILITIES_DIR_NAME, capabilityAtomicDeps } from '../ownershipRegistry';

export const LIBRARY_STATE_VERSION = 1;
export const LIBRARY_STATE_FILE_NAME = 'library.json';

export interface LibraryKey {
  readonly packageId: string;
  readonly engine: CapabilityEngine;
  readonly accountDir: string;
}
export interface LibraryInstallRecord extends LibraryKey {
  readonly version: string;
  readonly enabled: boolean;
  readonly package: CapabilityPackage; // copia de lo instalado (D-P2)
}
export interface LibraryState {
  readonly version: typeof LIBRARY_STATE_VERSION;
  readonly installs: readonly LibraryInstallRecord[];
}
export const EMPTY_LIBRARY_STATE: LibraryState = { version: LIBRARY_STATE_VERSION, installs: [] };

const stateSchema = z.object({
  version: z.literal(LIBRARY_STATE_VERSION),
  installs: z.array(
    z.object({
      packageId: z.string().min(1),
      engine: z.enum(CAPABILITY_ENGINES),
      accountDir: z.string().refine(isAbsolute, 'accountDir debe ser absoluto'),
      version: z.string().min(1),
      enabled: z.boolean(),
      package: z.unknown(),
    }),
  ),
});

export function libraryStatePath(userDataDir: string): string {
  if (userDataDir.trim() === '' || !isAbsolute(userDataDir)) {
    throw new Error(`userData de Mage inválido para el estado de la biblioteca: ${JSON.stringify(userDataDir)}`);
  }
  return join(userDataDir, CAPABILITIES_DIR_NAME, LIBRARY_STATE_FILE_NAME);
}

function corruptMessage(sourcePath: string, reason: string, text: string): string {
  return `Estado de la biblioteca corrupto en ${sourcePath} (${reason}): ${previewValue(text)}`;
}

function parseJson(text: string, sourcePath: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(corruptMessage(sourcePath, 'JSON inválido', text), { cause });
  }
}

export function parseLibraryState(text: string, sourcePath: string): LibraryState {
  const result = stateSchema.safeParse(parseJson(text, sourcePath));
  if (!result.success) throw new Error(corruptMessage(sourcePath, describeIssues(result.error), text));
  const installs = result.data.installs.map((raw): LibraryInstallRecord => {
    const pkg = parseCapabilityPackage(raw.package);
    if (pkg.id !== raw.packageId || pkg.version !== raw.version) {
      throw new Error(corruptMessage(sourcePath, `paquete incoherente con su registro: ${raw.packageId}`, text));
    }
    return { ...raw, package: pkg };
  });
  return { version: LIBRARY_STATE_VERSION, installs };
}

export function loadLibraryState(fs: CapabilityFs, path: string): LibraryState {
  // Primera vez: sin fichero no hay nada instalado. Cualquier otra cosa que no se pueda leer lanza.
  if (!fs.exists(path)) return EMPTY_LIBRARY_STATE;
  return parseLibraryState(fs.readFile(path).toString('utf8'), path);
}

export function saveLibraryState(fs: CapabilityFs, path: string, state: LibraryState): void {
  writeAtomic(capabilityAtomicDeps(fs), path, JSON.stringify(state, null, 2) + '\n');
}

export function sameAccountDir(a: string, b: string, caseInsensitive: boolean): boolean {
  const [left, right] = [resolve(a), resolve(b)];
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isKey(record: LibraryKey, key: LibraryKey, caseInsensitive: boolean): boolean {
  return (
    record.packageId === key.packageId &&
    record.engine === key.engine &&
    sameAccountDir(record.accountDir, key.accountDir, caseInsensitive)
  );
}

export function findInstall(state: LibraryState, key: LibraryKey, caseInsensitive: boolean): LibraryInstallRecord | null {
  return state.installs.find((r) => isKey(r, key, caseInsensitive)) ?? null;
}

export function withInstall(state: LibraryState, record: LibraryInstallRecord, caseInsensitive: boolean): LibraryState {
  const index = state.installs.findIndex((r) => isKey(r, record, caseInsensitive));
  if (index === -1) return { ...state, installs: [...state.installs, record] };
  return { ...state, installs: state.installs.map((r, i) => (i === index ? record : r)) };
}

export function withoutInstall(state: LibraryState, key: LibraryKey, caseInsensitive: boolean): LibraryState {
  return { ...state, installs: state.installs.filter((r) => !isKey(r, key, caseInsensitive)) };
}
