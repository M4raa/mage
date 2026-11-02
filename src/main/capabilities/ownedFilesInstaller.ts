// Instalador de los ficheros que Mage escribe por su cuenta (las skills sueltas de Claude, que no tienen gestor
// nativo), con el registro de propiedad de la decisión C3 de INFORME-046:
// - una colisión (ruta de otro paquete o fichero ajeno) se detecta ANTES de escribir nada;
// - desinstalar borra solo lo propio con el hash intacto: si el usuario lo tocó, no se borra NADA;
// - instalar y actualizar son la misma operación, transaccional: `.stage-<id>` → renombrar conservando la versión
//   anterior en `.prev-<id>` hasta verificar y guardar el registro.
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { renameWithRetry } from '../os/renameRetry';
import type { CapabilityFs } from './capabilityFs';
import type { CapabilityEngine, CapabilityPackage } from './capabilityPackage';
import {
  loadOwnershipRegistry,
  saveOwnershipRegistry,
  type OwnershipEntry,
  type OwnershipRegistry,
  type OwnershipScope,
} from './ownershipRegistry';

export interface OwnedFilesContext {
  readonly fs: CapabilityFs;
  readonly registryPath: string;
  // true en Windows y macOS: «A.md» y «a.md» son el mismo fichero.
  readonly caseInsensitivePaths: boolean;
}

export interface OwnedFilesRef {
  readonly packageId: string;
  readonly engine: CapabilityEngine;
  readonly scope: OwnershipScope;
}

export interface OwnedFilesTarget {
  readonly pkg: CapabilityPackage;
  readonly engine: CapabilityEngine;
  readonly scope: OwnershipScope;
  readonly targetRoot: string;
}

export type OwnershipCollision =
  | { readonly kind: 'ownedByOtherPackage'; readonly absPath: string; readonly ownerPackageId: string }
  | { readonly kind: 'foreignFile'; readonly absPath: string };

export type InstallOwnedResult =
  | { readonly status: 'installed'; readonly entries: readonly OwnershipEntry[] }
  | { readonly status: 'collision'; readonly collisions: readonly OwnershipCollision[] }
  | { readonly status: 'modifiedByUser'; readonly paths: readonly string[] };

export type UninstallOwnedResult =
  | { readonly status: 'uninstalled'; readonly removed: readonly string[] }
  | { readonly status: 'notInstalled' }
  | { readonly status: 'modifiedByUser'; readonly paths: readonly string[] };

export type RecoveryOutcome = 'clean' | 'committed' | 'rolledBack';

interface StagingPaths {
  readonly stage: string;
  readonly previous: string;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function stagingPaths(targetRoot: string, packageId: string): StagingPaths {
  return {
    stage: join(dirname(targetRoot), `.stage-${packageId}`),
    previous: join(dirname(targetRoot), `.prev-${packageId}`),
  };
}

function pathKey(ctx: OwnedFilesContext, p: string): string {
  const resolved = resolve(p);
  return ctx.caseInsensitivePaths ? resolved.toLowerCase() : resolved;
}

function isOwnEntry(entry: OwnershipEntry, ref: OwnedFilesRef): boolean {
  return entry.packageId === ref.packageId && entry.engine === ref.engine && entry.scope === ref.scope;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function rename(ctx: OwnedFilesContext, from: string, to: string): void {
  renameWithRetry({ rename: ctx.fs.rename, sleep: ctx.fs.sleep }, from, to);
}

// Rutas de las entradas cuyo fichero existe y ya no tiene el hash registrado. Un fichero propio ya ausente no cuenta:
// el usuario lo borró y no hay nada suyo que proteger.
function findModified(ctx: OwnedFilesContext, entries: readonly OwnershipEntry[]): string[] {
  return entries
    .filter((entry) => ctx.fs.exists(entry.absPath) && sha256Hex(ctx.fs.readFile(entry.absPath)) !== entry.sha256)
    .map((entry) => entry.absPath);
}

function assertInstallable(target: OwnedFilesTarget): void {
  const { pkg, engine, targetRoot } = target;
  if (!pkg.engines.includes(engine)) {
    throw new Error(`El paquete ${pkg.id} no declara el motor ${engine} (declara: ${pkg.engines.join(', ')})`);
  }
  if (!isAbsolute(targetRoot)) throw new Error(`targetRoot no es absoluta: ${JSON.stringify(targetRoot)}`);
  if (pkg.files.length === 0) throw new Error(`El paquete ${pkg.id} no trae ficheros: nada que instalar`);
}

// El contenido recibido debe ser EXACTAMENTE el declarado en el paquete, con los hashes declarados.
function verifyContents(pkg: CapabilityPackage, contents: ReadonlyMap<string, Buffer>): void {
  const declared = new Set(pkg.files.map((f) => f.relPath));
  for (const key of contents.keys()) {
    if (!declared.has(key)) throw new Error(`Contenido no declarado en el paquete ${pkg.id}: "${key}"`);
  }
  for (const { relPath, sha256 } of pkg.files) {
    const data = contents.get(relPath);
    if (data === undefined) throw new Error(`Falta el contenido de "${relPath}" del paquete ${pkg.id}`);
    const actual = sha256Hex(data);
    if (actual !== sha256) {
      throw new Error(`Hash de "${relPath}" distinto del declarado: esperado ${sha256}, obtenido ${actual}`);
    }
  }
}

function otherOwner(entries: readonly OwnershipEntry[], packageId: string): OwnershipEntry | undefined {
  return entries.find((entry) => entry.packageId !== packageId);
}

function indexByPathKey(ctx: OwnedFilesContext, entries: readonly OwnershipEntry[]): Map<string, OwnershipEntry[]> {
  const index = new Map<string, OwnershipEntry[]>();
  for (const entry of entries) {
    const key = pathKey(ctx, entry.absPath);
    index.set(key, [...(index.get(key) ?? []), entry]);
  }
  return index;
}

// Colisiones con un Map por clave de ruta: una ruta se informa una sola vez aunque salga de las dos reglas.
function findCollisions(ctx: OwnedFilesContext, registry: OwnershipRegistry, target: OwnedFilesTarget): OwnershipCollision[] {
  const index = indexByPathKey(ctx, registry.entries);
  const found = new Map<string, OwnershipCollision>();
  const ref: OwnedFilesRef = { packageId: target.pkg.id, engine: target.engine, scope: target.scope };
  const check = (absPath: string, isExisting: boolean): void => {
    const key = pathKey(ctx, absPath);
    if (found.has(key)) return;
    const entries = index.get(key) ?? [];
    const owner = otherOwner(entries, target.pkg.id);
    if (owner !== undefined) {
      found.set(key, { kind: 'ownedByOtherPackage', absPath, ownerPackageId: owner.packageId });
      return;
    }
    if (isExisting && !isOwnAndIntact(ctx, entries, ref, absPath)) found.set(key, { kind: 'foreignFile', absPath });
  };
  for (const file of target.pkg.files) check(join(target.targetRoot, file.relPath), false);
  for (const existing of ctx.fs.listFiles(target.targetRoot)) check(existing, true);
  return [...found.values()];
}

function isOwnAndIntact(ctx: OwnedFilesContext, entries: readonly OwnershipEntry[], ref: OwnedFilesRef, absPath: string): boolean {
  const hash = sha256Hex(ctx.fs.readFile(absPath));
  return entries.some((entry) => isOwnEntry(entry, ref) && entry.sha256 === hash);
}

function writeStage(ctx: OwnedFilesContext, stage: string, pkg: CapabilityPackage, contents: ReadonlyMap<string, Buffer>): void {
  ctx.fs.removeTree(stage);
  for (const { relPath } of pkg.files) ctx.fs.writeFile(join(stage, relPath), contents.get(relPath) as Buffer);
}

function verifyTree(ctx: OwnedFilesContext, root: string, pkg: CapabilityPackage): void {
  for (const { relPath, sha256 } of pkg.files) {
    const path = join(root, relPath);
    if (!ctx.fs.exists(path)) throw new Error(`Falta el fichero verificado: ${path}`);
    if (sha256Hex(ctx.fs.readFile(path)) !== sha256) throw new Error(`Hash incorrecto tras escribir: ${path}`);
  }
}

function prepareStage(ctx: OwnedFilesContext, paths: StagingPaths, target: OwnedFilesTarget, contents: ReadonlyMap<string, Buffer>): void {
  try {
    writeStage(ctx, paths.stage, target.pkg, contents);
    verifyTree(ctx, paths.stage, target.pkg);
  } catch (cause) {
    ctx.fs.removeTree(paths.stage);
    throw new Error(`No se pudo preparar ${target.pkg.id}: ${errorMessage(cause)}`, { cause });
  }
}

// ponytail: en una instalación NUEVA, una caída del proceso entre publicar y guardar el registro deja ficheros sin
// registrar, que la siguiente instalación verá como `foreignFile`; se mejora guardando un marcador en el stage si llega
// a pasar.
function publish(ctx: OwnedFilesContext, target: OwnedFilesTarget, paths: StagingPaths): void {
  if (ctx.fs.exists(target.targetRoot)) rename(ctx, target.targetRoot, paths.previous);
  rename(ctx, paths.stage, target.targetRoot);
  verifyTree(ctx, target.targetRoot, target.pkg);
}

// `hadTarget` evita un borrado indebido: si el fallo llegó antes de mover la versión instalada a `.prev`, el destino
// sigue siendo esa versión y no se toca.
function rollback(ctx: OwnedFilesContext, target: OwnedFilesTarget, paths: StagingPaths, hadTarget: boolean): void {
  ctx.fs.removeTree(paths.stage);
  if (ctx.fs.exists(paths.previous)) {
    ctx.fs.removeTree(target.targetRoot);
    rename(ctx, paths.previous, target.targetRoot);
    return;
  }
  if (!hadTarget) ctx.fs.removeTree(target.targetRoot);
}

function buildEntries(target: OwnedFilesTarget): OwnershipEntry[] {
  const { pkg, engine, scope, targetRoot } = target;
  return pkg.files.map((f) => ({ packageId: pkg.id, engine, scope, absPath: join(targetRoot, f.relPath), sha256: f.sha256 }));
}

// Publica y registra; si algo falla ANTES de guardar el registro, restaura la versión anterior. Borrar `.prev` va
// fuera del try a propósito: la versión nueva ya está publicada y registrada, y `recoverInterruptedUpdate` lo limpia.
function commit(ctx: OwnedFilesContext, target: OwnedFilesTarget, paths: StagingPaths, next: OwnershipRegistry): void {
  const hadTarget = ctx.fs.exists(target.targetRoot);
  try {
    publish(ctx, target, paths);
    saveOwnershipRegistry(ctx.fs, ctx.registryPath, next);
  } catch (cause) {
    rollback(ctx, target, paths, hadTarget);
    const message = `Actualización de ${target.pkg.id} fallida; se ha restaurado la versión anterior: ${errorMessage(cause)}`;
    throw new Error(message, { cause });
  }
  ctx.fs.removeTree(paths.previous);
}

export function installOwnedFiles(
  ctx: OwnedFilesContext,
  target: OwnedFilesTarget,
  contents: ReadonlyMap<string, Buffer>,
): InstallOwnedResult {
  assertInstallable(target);
  verifyContents(target.pkg, contents);
  const ref = { packageId: target.pkg.id, engine: target.engine, scope: target.scope, targetRoot: target.targetRoot };
  recoverInterruptedUpdate(ctx, ref);
  const registry = loadOwnershipRegistry(ctx.fs, ctx.registryPath);
  const modified = findModified(ctx, registry.entries.filter((e) => isOwnEntry(e, ref)));
  if (modified.length > 0) return { status: 'modifiedByUser', paths: modified };
  const collisions = findCollisions(ctx, registry, target);
  if (collisions.length > 0) return { status: 'collision', collisions };

  const paths = stagingPaths(target.targetRoot, target.pkg.id);
  prepareStage(ctx, paths, target, contents);
  const entries = buildEntries(target);
  const kept = registry.entries.filter((e) => !isOwnEntry(e, ref));
  commit(ctx, target, paths, { ...registry, entries: [...kept, ...entries] });
  return { status: 'installed', entries };
}

export function uninstallOwnedFiles(ctx: OwnedFilesContext, ref: OwnedFilesRef): UninstallOwnedResult {
  const registry = loadOwnershipRegistry(ctx.fs, ctx.registryPath);
  const own = registry.entries.filter((e) => isOwnEntry(e, ref));
  if (own.length === 0) return { status: 'notInstalled' };
  const modified = findModified(ctx, own);
  if (modified.length > 0) return { status: 'modifiedByUser', paths: modified };

  // Los directorios que queden vacíos no se borran: lo propio son los ficheros.
  const removed = own.map((e) => e.absPath).filter((p) => ctx.fs.exists(p));
  for (const path of removed) ctx.fs.removeFile(path);
  saveOwnershipRegistry(ctx.fs, ctx.registryPath, { ...registry, entries: registry.entries.filter((e) => !isOwnEntry(e, ref)) });
  return { status: 'uninstalled', removed };
}

// Limpia los restos de una actualización interrumpida: un stage nunca se publicó; un `.prev` con el registro y los
// ficheros nuevos intactos es una actualización ya confirmada, y sin ellos hay que volver a la versión anterior.
export function recoverInterruptedUpdate(ctx: OwnedFilesContext, ref: OwnedFilesRef & { readonly targetRoot: string }): RecoveryOutcome {
  const paths = stagingPaths(ref.targetRoot, ref.packageId);
  if (ctx.fs.exists(paths.stage)) ctx.fs.removeTree(paths.stage);
  if (!ctx.fs.exists(paths.previous)) return 'clean';

  const registry = loadOwnershipRegistry(ctx.fs, ctx.registryPath);
  const own = registry.entries.filter((e) => isOwnEntry(e, ref));
  if (own.length > 0 && own.every((e) => isIntact(ctx, e))) {
    ctx.fs.removeTree(paths.previous);
    return 'committed';
  }
  if (ctx.fs.exists(ref.targetRoot)) ctx.fs.removeTree(ref.targetRoot);
  rename(ctx, paths.previous, ref.targetRoot);
  return 'rolledBack';
}

function isIntact(ctx: OwnedFilesContext, entry: OwnershipEntry): boolean {
  return ctx.fs.exists(entry.absPath) && sha256Hex(ctx.fs.readFile(entry.absPath)) === entry.sha256;
}
