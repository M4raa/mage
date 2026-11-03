// Servicio de la biblioteca de capacidades: el ciclo instalar, activar/desactivar, actualizar y quitar, por CUENTA y
// motor, con el estado en `library.json` (D-P1..D-P7). Todo llega inyectado (FS, ejecutor, cuentas, binarios): se
// prueba entero en memoria. Los comandos de los CLI van con el entorno saneado (`runNativeCommand`, sin ninguna clave).
import { basename } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import type {
  LibraryAccountView,
  LibraryAction,
  LibraryActionResult,
  LibraryBlock,
  LibraryComponentView,
  LibraryEntryView,
  LibraryInstallView,
  LibraryPreviewView,
  LibraryTarget,
  LibraryView,
} from '@shared/ipc';
import { parseCodexMcpList } from '../../config/codexMcp';
import type { CapabilityFs } from '../capabilityFs';
import type { CapabilityEngine, CapabilityPackage } from '../capabilityPackage';
import { previewValue } from '../capabilityPackage';
import type { CommandRunner } from '../commandRunner';
import { claudeSkillRoot, installRouteFor } from '../installRoute';
import {
  nativeInstallCommands,
  nativeListCommand,
  nativeUninstallCommands,
  withPlatformLauncher,
} from '../nativeCommands';
import { runNativeCommand, runNativeCommands, type NativeRunContext } from '../nativeRunner';
import { installOwnedFiles, uninstallOwnedFiles, type OwnedFilesContext } from '../ownedFilesInstaller';
import { ownershipRegistryPath } from '../ownershipRegistry';
import type { LibraryCatalogEntry, LibraryComponent } from '../catalog/libraryCatalog';
import { INSTALL_BLOCKS, installBlockFor, previewInstall } from '../catalog/libraryPreview';
import {
  findInstall,
  libraryStatePath,
  loadLibraryState,
  sameAccountDir,
  saveLibraryState,
  withInstall,
  withoutInstall,
  type LibraryInstallRecord,
  type LibraryKey,
  type LibraryState,
} from './libraryState';

// Los bloqueos del renderer (ipc.ts) y los del catálogo son la misma lista: si divergen, esto no compila.
export const LIBRARY_BLOCKS: readonly LibraryBlock[] = INSTALL_BLOCKS;

export interface LibraryAccount {
  readonly configDir: string;
  readonly engine: CapabilityEngine;
}

export interface LibraryServiceDeps {
  readonly catalog: readonly LibraryCatalogEntry[];
  readonly contentsOf: (entry: LibraryCatalogEntry) => ReadonlyMap<string, Buffer>;
  readonly fs: CapabilityFs;
  readonly userDataDir: string;
  readonly platform: NodeJS.Platform;
  readonly caseInsensitivePaths: boolean;
  readonly listAccounts: () => readonly LibraryAccount[];
  readonly binaryFor: (engine: CapabilityEngine) => string; // lanza UserFacingError si el CLI no está
  readonly runner: CommandRunner;
  readonly baseEnv: () => NodeJS.ProcessEnv;
  readonly isCommandAvailable: (command: string) => boolean;
}

const DONE: LibraryActionResult = { status: 'done', appliesOnNextSession: true };
const ACTIONS_NEEDING_ENTRY: ReadonlySet<LibraryAction> = new Set(['install', 'enable', 'update']);

export function toComponentView(c: LibraryComponent): LibraryComponentView {
  return { engine: c.engine, kind: c.kind, count: c.count ?? null, names: c.names ?? [] };
}

interface Operation {
  readonly key: LibraryKey;
  readonly entry: LibraryCatalogEntry | null;
  readonly state: LibraryState;
  readonly record: LibraryInstallRecord | null;
}

export class LibraryService {
  private readonly byId: ReadonlyMap<string, LibraryCatalogEntry>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: LibraryServiceDeps) {
    this.byId = new Map(deps.catalog.map((entry) => [entry.id, entry]));
  }

  view(): LibraryView {
    const { deps } = this;
    const state = loadLibraryState(deps.fs, libraryStatePath(deps.userDataDir));
    return {
      platform: deps.platform,
      accounts: deps.listAccounts().map(toAccountView),
      entries: deps.catalog.map((entry) => this.toEntryView(entry)),
      installs: state.installs.map((record) => this.toInstallView(record)),
    };
  }

  preview(target: LibraryTarget): LibraryPreviewView {
    const { key, entry } = this.resolveTarget(target, true);
    if (entry === null) throw new Error(`Vista previa sin paquete: ${previewValue(target)}`);
    const { engine, accountDir } = key;
    const contents = entry.distribution === 'copied' ? this.deps.contentsOf(entry) : null;
    const result = previewInstall({ entry, engine, accountDir, platform: this.deps.platform }, contents);
    return { ...result, components: result.components.map(toComponentView) };
  }

  apply(action: LibraryAction, target: LibraryTarget): Promise<LibraryActionResult> {
    // El `catch` de la cola NO silencia nada: el error sigue en `run`, que es lo que recibe quien llama. Solo evita
    // que una acción fallida deje rechazada la cola y bloquee las siguientes (D-P5).
    const run = this.tail.then(() => this.applyNow(action, target));
    this.tail = run.catch(() => undefined);
    return run;
  }

  // --- Validación -----------------------------------------------------------------------------------------

  private resolveTarget(target: LibraryTarget, needsEntry: boolean): Omit<Operation, 'state' | 'record'> {
    const account = this.deps
      .listAccounts()
      .find((a) => a.engine === target.engine && sameAccountDir(a.configDir, target.accountDir, this.deps.caseInsensitivePaths));
    if (account === undefined) {
      throw new UserFacingError(
        localized('errors.capabilities.unknownAccount', { accountDir: target.accountDir, engine: target.engine }),
      );
    }
    // Desde aquí manda el configDir de la LISTA de main, nunca el que mandó el renderer (D-P1).
    const key = { packageId: target.packageId, engine: target.engine, accountDir: account.configDir };
    const entry = this.byId.get(target.packageId) ?? null;
    if (needsEntry && entry === null) {
      throw new UserFacingError(localized('errors.capabilities.unknownPackage', { packageId: target.packageId }));
    }
    return { key, entry };
  }

  private assertInstallable(entry: LibraryCatalogEntry, engine: CapabilityEngine): void {
    const packageId = entry.package.id;
    if (installBlockFor(entry, engine, this.deps.platform) !== null) {
      throw new UserFacingError(localized('errors.capabilities.blocked', { packageId, engine }));
    }
    const missing = this.missingCommands(entry);
    if (missing.length > 0) {
      throw new UserFacingError(localized('errors.capabilities.missingCommand', { packageId, command: missing[0] as string }));
    }
  }

  private missingCommands(entry: LibraryCatalogEntry): readonly string[] {
    return (entry.package.requires.commands ?? []).filter((c) => !this.deps.isCommandAvailable(c));
  }

  // --- Acciones -------------------------------------------------------------------------------------------

  private async applyNow(action: LibraryAction, target: LibraryTarget): Promise<LibraryActionResult> {
    const { key, entry } = this.resolveTarget(target, ACTIONS_NEEDING_ENTRY.has(action));
    const state = loadLibraryState(this.deps.fs, libraryStatePath(this.deps.userDataDir));
    const op: Operation = { key, entry, state, record: findInstall(state, key, this.deps.caseInsensitivePaths) };
    switch (action) {
      case 'install':
        return this.install(op);
      case 'enable':
        return this.enable(op);
      case 'disable':
        return this.disable(op);
      case 'update':
        return this.update(op);
      case 'remove':
        return this.remove(op);
    }
  }

  private requireRecord(op: Operation): LibraryInstallRecord {
    if (op.record === null) {
      throw new UserFacingError(localized('errors.capabilities.notInstalled', { packageId: op.key.packageId }));
    }
    return op.record;
  }

  private requireEntry(op: Operation): LibraryCatalogEntry {
    if (op.entry === null) throw new Error(`Falta la entrada del catálogo de ${op.key.packageId}`);
    return op.entry;
  }

  private async install(op: Operation): Promise<LibraryActionResult> {
    const entry = this.requireEntry(op);
    if (op.record !== null) {
      throw new UserFacingError(localized('errors.capabilities.alreadyInstalled', { packageId: op.key.packageId }));
    }
    this.assertInstallable(entry, op.key.engine);
    const result = await this.installPackage(entry.package, op.key, entry);
    return this.settle(result, op, () => this.recordOf(op.key, entry.package, true));
  }

  private async enable(op: Operation): Promise<LibraryActionResult> {
    const entry = this.requireEntry(op);
    const record = this.requireRecord(op);
    if (record.enabled) {
      throw new UserFacingError(localized('errors.capabilities.alreadyEnabled', { packageId: op.key.packageId }));
    }
    this.assertInstallable(entry, op.key.engine);
    const result = await this.installPackage(entry.package, op.key, entry);
    return this.settle(result, op, () => this.recordOf(op.key, entry.package, true));
  }

  private async disable(op: Operation): Promise<LibraryActionResult> {
    const record = this.requireRecord(op);
    if (!record.enabled) {
      throw new UserFacingError(localized('errors.capabilities.alreadyDisabled', { packageId: op.key.packageId }));
    }
    const result = await this.uninstallPackage(record.package, op.key);
    return this.settle(result, op, () => ({ ...record, enabled: false }));
  }

  private async remove(op: Operation): Promise<LibraryActionResult> {
    const record = this.requireRecord(op);
    const result = record.enabled ? await this.uninstallPackage(record.package, op.key) : DONE;
    if (result.status !== 'done') return result;
    saveLibraryState(this.deps.fs, libraryStatePath(this.deps.userDataDir), withoutInstall(op.state, op.key, this.deps.caseInsensitivePaths));
    return DONE;
  }

  private async update(op: Operation): Promise<LibraryActionResult> {
    const entry = this.requireEntry(op);
    const record = this.requireRecord(op);
    const { packageId } = op.key;
    if (!record.enabled) throw new UserFacingError(localized('errors.capabilities.alreadyDisabled', { packageId }));
    if (record.version === entry.package.version) {
      throw new UserFacingError(localized('errors.capabilities.upToDate', { packageId, version: record.version }));
    }
    this.assertInstallable(entry, op.key.engine);
    const result =
      installRouteFor(entry.package, op.key.engine) === 'ownedFiles'
        ? await this.installPackage(entry.package, op.key, entry)
        : await this.replaceNative(record, op.key, entry);
    return this.settle(result, op, () => this.recordOf(op.key, entry.package, true));
  }

  // Lo nativo no tiene transacción: se quita la versión vieja y se instala la nueva; si la nueva falla, se vuelve a
  // dejar la vieja. `rolledBack` no cambia el estado.
  private async replaceNative(record: LibraryInstallRecord, key: LibraryKey, entry: LibraryCatalogEntry): Promise<LibraryActionResult> {
    const removed = await this.uninstallPackage(record.package, key);
    if (removed.status !== 'done') return removed;
    try {
      return await this.installPackage(entry.package, key, entry);
    } catch (newError) {
      return this.restoreOld(record, key, newError);
    }
  }

  private async restoreOld(record: LibraryInstallRecord, key: LibraryKey, newError: unknown): Promise<LibraryActionResult> {
    const detail = newError instanceof Error ? newError.message : String(newError);
    try {
      await this.installPackage(record.package, key, null);
    } catch (oldError) {
      const oldDetail = oldError instanceof Error ? oldError.message : String(oldError);
      // ponytail: el estado dice instalada una versión que no lo está; se arregla quitándola y volviendo a instalar.
      throw new Error(
        `No se pudo actualizar ${key.packageId} ni restaurar la versión ${record.version}: ${detail}; ${oldDetail}`,
        { cause: oldError },
      );
    }
    return { status: 'rolledBack', detail };
  }

  // Guarda el estado solo si la acción terminó bien; `collision` y `modifiedByUser` lo dejan como estaba.
  private settle(result: LibraryActionResult, op: Operation, next: () => LibraryInstallRecord): LibraryActionResult {
    if (result.status !== 'done') return result;
    const state = withInstall(op.state, next(), this.deps.caseInsensitivePaths);
    saveLibraryState(this.deps.fs, libraryStatePath(this.deps.userDataDir), state);
    return result;
  }

  private recordOf(key: LibraryKey, pkg: CapabilityPackage, enabled: boolean): LibraryInstallRecord {
    return { ...key, version: pkg.version, enabled, package: pkg };
  }

  // --- Instalar y quitar de verdad ------------------------------------------------------------------------

  private ownedCtx(): OwnedFilesContext {
    const { fs, userDataDir, caseInsensitivePaths } = this.deps;
    return { fs, registryPath: ownershipRegistryPath(userDataDir), caseInsensitivePaths };
  }

  private nativeCtx(key: LibraryKey): NativeRunContext {
    const { binaryFor, runner, baseEnv } = this.deps;
    return { engine: key.engine, binary: binaryFor(key.engine), configDir: key.accountDir, runner, baseEnv: baseEnv() };
  }

  private async installPackage(pkg: CapabilityPackage, key: LibraryKey, entry: LibraryCatalogEntry | null): Promise<LibraryActionResult> {
    if (installRouteFor(pkg, key.engine) === 'ownedFiles') return this.installFiles(pkg, key, entry);
    return this.installNative(pkg, key);
  }

  private installFiles(pkg: CapabilityPackage, key: LibraryKey, entry: LibraryCatalogEntry | null): LibraryActionResult {
    if (entry === null) throw new Error(`Faltan los contenidos que copiar de ${pkg.id}`);
    const targetRoot = claudeSkillRoot(key.accountDir, pkg.id);
    const result = installOwnedFiles(this.ownedCtx(), { pkg, engine: key.engine, scope: 'user', targetRoot }, this.deps.contentsOf(entry));
    if (result.status === 'installed') return DONE;
    if (result.status === 'collision') return { status: 'collision', items: result.collisions.map((c) => c.absPath) };
    return { status: 'modifiedByUser', items: result.paths };
  }

  private async installNative(pkg: CapabilityPackage, key: LibraryKey): Promise<LibraryActionResult> {
    const { native } = pkg;
    if (native === undefined) throw new Error(`El paquete ${pkg.id} no declara native y su ruta es nativa`);
    const ctx = this.nativeCtx(key);
    const foreign = await this.foreignCodexServer(ctx, native);
    if (foreign !== null) return { status: 'collision', items: [`codex mcp: ${foreign}`] };
    await runNativeCommands(ctx, nativeInstallCommands(key.engine, withPlatformLauncher(native, this.deps.platform)));
    return DONE;
  }

  // D-P6: `codex mcp add` con un nombre ocupado puede sobrescribirlo. A `install` y `enable` solo se llega sin un
  // registro activo de Mage para esa clave, así que un nombre que ya exista es ajeno.
  private async foreignCodexServer(ctx: NativeRunContext, native: NonNullable<CapabilityPackage['native']>): Promise<string | null> {
    if (ctx.engine !== 'codex' || native.type !== 'mcpStdio') return null;
    const listed = parseCodexMcpList(await runNativeCommand(ctx, nativeListCommand('codex', 'mcpStdio')));
    return listed.some((server) => server.name === native.name) ? native.name : null;
  }

  private async uninstallPackage(pkg: CapabilityPackage, key: LibraryKey): Promise<LibraryActionResult> {
    if (installRouteFor(pkg, key.engine) === 'ownedFiles') return this.uninstallFiles(pkg, key);
    if (pkg.native === undefined) throw new Error(`El paquete ${pkg.id} no declara native y su ruta es nativa`);
    await runNativeCommands(this.nativeCtx(key), nativeUninstallCommands(key.engine, pkg.native));
    return DONE;
  }

  private uninstallFiles(pkg: CapabilityPackage, key: LibraryKey): LibraryActionResult {
    const targetRoot = claudeSkillRoot(key.accountDir, pkg.id);
    const result = uninstallOwnedFiles(this.ownedCtx(), { packageId: pkg.id, engine: key.engine, scope: 'user', targetRoot });
    if (result.status === 'modifiedByUser') return { status: 'modifiedByUser', items: result.paths };
    return DONE;
  }

  // --- Vistas ---------------------------------------------------------------------------------------------

  private toEntryView(entry: LibraryCatalogEntry): LibraryEntryView {
    const { package: pkg, provenance } = entry;
    const { platform } = this.deps;
    return {
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      publisher: entry.publisher,
      kind: pkg.kind,
      version: pkg.version,
      engines: pkg.engines,
      platforms: entry.platforms,
      scopes: entry.scopes,
      provenance: { ...provenance, commit: provenance.commit ?? null, path: provenance.path ?? null },
      license: entry.license,
      distribution: entry.distribution,
      runsCode: entry.runsCode,
      components: entry.components.map(toComponentView),
      requiresCommands: pkg.requires.commands ?? [],
      missingCommands: this.missingCommands(entry),
      requiresSecrets: pkg.requires.secrets ?? [],
      blocks: { claude: installBlockFor(entry, 'claude', platform), codex: installBlockFor(entry, 'codex', platform) },
    };
  }

  private toInstallView(record: LibraryInstallRecord): LibraryInstallView {
    const entry = this.byId.get(record.packageId) ?? null;
    const inCatalog = entry !== null;
    const outdated = entry !== null && record.version !== entry.package.version;
    return {
      packageId: record.packageId,
      engine: record.engine,
      accountDir: record.accountDir,
      version: record.version,
      enabled: record.enabled,
      inCatalog,
      updateAvailable: record.enabled && inCatalog && outdated,
    };
  }
}

function toAccountView(account: LibraryAccount): LibraryAccountView {
  return { accountDir: account.configDir, engine: account.engine, label: basename(account.configDir) };
}
