import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCapabilityPackage, type CapabilityPackage } from './capabilityPackage';
import { createMemoryCapabilityFs } from './memoryCapabilityFs';
import {
  installOwnedFiles,
  recoverInterruptedUpdate,
  sha256Hex,
  uninstallOwnedFiles,
  type OwnedFilesContext,
  type OwnedFilesRef,
  type OwnedFilesTarget,
} from './ownedFilesInstaller';
import { loadOwnershipRegistry } from './ownershipRegistry';

const ROOT = resolve('/fake');
const REGISTRY_PATH = join(ROOT, 'userData', 'capabilities', 'ownership.json');
const SKILLS_DIR = join(ROOT, 'cfg', 'skills');
const TARGET_ROOT = join(SKILLS_DIR, 'demo-skill');
const STAGE = join(SKILLS_DIR, '.stage-demo-skill');
const PREVIOUS = join(SKILLS_DIR, '.prev-demo-skill');
const REF: OwnedFilesRef & { readonly targetRoot: string } = {
  packageId: 'demo-skill',
  engine: 'claude',
  scope: 'user',
  targetRoot: TARGET_ROOT,
};

type Contents = Map<string, Buffer>;

function build(texts: Record<string, string>, extra: Record<string, unknown> = {}): [CapabilityPackage, Contents] {
  const contents: Contents = new Map(Object.entries(texts).map(([rel, text]) => [rel, Buffer.from(text)]));
  const files = [...contents].map(([relPath, data]) => ({ relPath, sha256: sha256Hex(data) }));
  const pkg = parseCapabilityPackage({
    id: 'demo-skill',
    version: '1.0.0',
    source: { url: 'https://example.com/demo.tgz', sha256: 'a'.repeat(64) },
    license: 'MIT',
    kind: 'skill',
    engines: ['claude'],
    files,
    ...extra,
  });
  return [pkg, contents];
}

const v1 = (): [CapabilityPackage, Contents] => build({ 'SKILL.md': 'hola v1', 'scripts/run.sh': 'echo v1' });
const v2 = (): [CapabilityPackage, Contents] => build({ 'SKILL.md': 'hola v2' });

function targetFor(pkg: CapabilityPackage, overrides: Partial<OwnedFilesTarget> = {}): OwnedFilesTarget {
  return { pkg, engine: 'claude', scope: 'user', targetRoot: TARGET_ROOT, ...overrides };
}

function setup(caseInsensitivePaths = false) {
  const mem = createMemoryCapabilityFs();
  const ctx: OwnedFilesContext = { fs: mem.fs, registryPath: REGISTRY_PATH, caseInsensitivePaths };
  const text = (path: string): string => mem.fs.readFile(path).toString('utf8');
  const install = (built: [CapabilityPackage, Contents], overrides: Partial<OwnedFilesTarget> = {}) =>
    installOwnedFiles(ctx, targetFor(built[0], overrides), built[1]);
  return { ...mem, ctx, text, install };
}

function hasLeftovers(files: Map<string, Buffer>): boolean {
  return [...files.keys()].some((key) => key.includes('.stage-') || key.includes('.prev-'));
}

describe('installOwnedFiles', () => {
  it('installOwnedFiles_freshTarget_writesFilesAndRegistersEntries', () => {
    // Arrange
    const { ctx, files, text, install } = setup();
    // Act
    const result = install(v1());
    // Assert
    expect(result.status).toBe('installed');
    expect(text(join(TARGET_ROOT, 'SKILL.md'))).toBe('hola v1');
    expect(text(join(TARGET_ROOT, 'scripts/run.sh'))).toBe('echo v1');
    const entries = loadOwnershipRegistry(ctx.fs, REGISTRY_PATH).entries;
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.absPath.startsWith(TARGET_ROOT))).toBe(true);
    expect(hasLeftovers(files)).toBe(false);
  });

  it('installOwnedFiles_contentShaMismatch_throwsAndWritesNothing', () => {
    // Arrange
    const { files, ctx } = setup();
    const [pkg] = v1();
    const wrong: Contents = new Map([
      ['SKILL.md', Buffer.from('otro texto')],
      ['scripts/run.sh', Buffer.from('echo v1')],
    ]);
    // Act / Assert
    expect(() => installOwnedFiles(ctx, targetFor(pkg), wrong)).toThrow(/SKILL.md/);
    expect(files.size).toBe(0);
  });

  it('installOwnedFiles_contentsMissingFile_throws', () => {
    // Arrange
    const { ctx } = setup();
    const [pkg, contents] = v1();
    contents.delete('scripts/run.sh');
    // Act / Assert
    expect(() => installOwnedFiles(ctx, targetFor(pkg), contents)).toThrow(/scripts\/run.sh/);
  });

  it('installOwnedFiles_contentsExtraFile_throws', () => {
    // Arrange
    const { ctx } = setup();
    const [pkg, contents] = v1();
    contents.set('otro.md', Buffer.from('x'));
    // Act / Assert
    expect(() => installOwnedFiles(ctx, targetFor(pkg), contents)).toThrow(/otro.md/);
  });

  it('installOwnedFiles_packageWithoutFiles_throws', () => {
    // Arrange
    const { ctx } = setup();
    const [pkg] = build(
      {},
      { id: 'demo-mcp', kind: 'mcp', native: { type: 'mcpStdio', name: 'demo', command: 'node' } },
    );
    // Act / Assert
    expect(() => installOwnedFiles(ctx, targetFor(pkg), new Map())).toThrow(/nada que instalar/);
  });

  it('installOwnedFiles_engineNotInPackage_throws', () => {
    // Arrange
    const { ctx } = setup();
    const [pkg, contents] = v1();
    // Act / Assert
    expect(() => installOwnedFiles(ctx, targetFor(pkg, { engine: 'codex' }), contents)).toThrow(/codex/);
  });

  it('installOwnedFiles_relativeTargetRoot_throws', () => {
    // Arrange
    const { ctx } = setup();
    const [pkg, contents] = v1();
    // Act / Assert
    expect(() => installOwnedFiles(ctx, targetFor(pkg, { targetRoot: 'skills/demo' }), contents)).toThrow(/skills\/demo/);
  });

  it('installOwnedFiles_pathOwnedByOtherPackage_returnsCollisionAndWritesNothing', () => {
    // Arrange
    const { put, files, text, install } = setup();
    const entry = { packageId: 'otro-paquete', engine: 'claude', scope: 'user', absPath: join(TARGET_ROOT, 'SKILL.md'), sha256: 'c'.repeat(64) };
    put(REGISTRY_PATH, JSON.stringify({ version: 1, entries: [entry] }));
    const before = text(REGISTRY_PATH);
    // Act
    const result = install(v1());
    // Assert
    expect(result).toEqual({
      status: 'collision',
      collisions: [{ kind: 'ownedByOtherPackage', absPath: join(TARGET_ROOT, 'SKILL.md'), ownerPackageId: 'otro-paquete' }],
    });
    expect(text(REGISTRY_PATH)).toBe(before);
    expect([...files.keys()]).toEqual([REGISTRY_PATH]);
  });

  it('installOwnedFiles_foreignFileInTarget_returnsCollisionAndWritesNothing', () => {
    // Arrange
    const { put, files, text, install } = setup();
    const notes = join(TARGET_ROOT, 'notas.txt');
    put(notes, 'mis notas');
    // Act
    const result = install(v1());
    // Assert
    expect(result).toEqual({ status: 'collision', collisions: [{ kind: 'foreignFile', absPath: notes }] });
    expect(text(notes)).toBe('mis notas');
    expect(files.has(REGISTRY_PATH)).toBe(false);
  });

  it('installOwnedFiles_caseInsensitivePaths_detectsCollisionDifferingOnlyInCase', () => {
    // Arrange
    const { put, install } = setup(true);
    const entry = { packageId: 'otro-paquete', engine: 'claude', scope: 'user', absPath: join(TARGET_ROOT, 'skill.md'), sha256: 'c'.repeat(64) };
    put(REGISTRY_PATH, JSON.stringify({ version: 1, entries: [entry] }));
    // Act
    const result = install(v1());
    // Assert
    expect(result.status).toBe('collision');
    expect(result).toMatchObject({ collisions: [{ kind: 'ownedByOtherPackage', ownerPackageId: 'otro-paquete' }] });
  });

  it('installOwnedFiles_reinstallSameVersionIntact_succeeds', () => {
    // Arrange
    const { ctx, install } = setup();
    install(v1());
    // Act
    const result = install(v1());
    // Assert
    expect(result.status).toBe('installed');
    expect(loadOwnershipRegistry(ctx.fs, REGISTRY_PATH).entries).toHaveLength(2);
  });

  it('installOwnedFiles_updateToNewVersion_replacesFilesAndEntries', () => {
    // Arrange
    const { ctx, files, text, install, fs } = setup();
    install(v1());
    const [pkg2] = v2();
    // Act
    const result = install(v2());
    // Assert
    expect(result.status).toBe('installed');
    expect(text(join(TARGET_ROOT, 'SKILL.md'))).toBe('hola v2');
    expect(fs.exists(join(TARGET_ROOT, 'scripts/run.sh'))).toBe(false);
    const entries = loadOwnershipRegistry(ctx.fs, REGISTRY_PATH).entries;
    expect(entries).toHaveLength(1);
    expect(entries.map((e) => e.sha256)).toEqual(pkg2.files.map((f) => f.sha256));
    expect(fs.exists(PREVIOUS)).toBe(false);
    expect(hasLeftovers(files)).toBe(false);
  });

  it('installOwnedFiles_ownFileModifiedByUser_returnsModifiedByUser', () => {
    // Arrange
    const { put, text, install } = setup();
    install(v1());
    const skill = join(TARGET_ROOT, 'SKILL.md');
    put(skill, 'texto del usuario');
    // Act
    const result = install(v2());
    // Assert
    expect(result).toEqual({ status: 'modifiedByUser', paths: [skill] });
    expect(text(skill)).toBe('texto del usuario');
  });

  it('installOwnedFiles_stageWriteFails_keepsPreviousVersionAndRegistry', () => {
    // Arrange
    const { failNext, text, install, fs, files } = setup();
    install(v1());
    const registryBefore = text(REGISTRY_PATH);
    failNext('writeFile', '.stage-demo-skill');
    // Act / Assert
    expect(() => install(v2())).toThrow(/No se pudo preparar/);
    expect(text(join(TARGET_ROOT, 'SKILL.md'))).toBe('hola v1');
    expect(fs.exists(join(TARGET_ROOT, 'scripts/run.sh'))).toBe(true);
    expect(text(REGISTRY_PATH)).toBe(registryBefore);
    expect(fs.exists(STAGE)).toBe(false);
    expect(hasLeftovers(files)).toBe(false);
  });

  it('installOwnedFiles_publishRenameFails_restoresPreviousVersionAndRegistry', () => {
    // Arrange
    const { failNext, text, install, fs, files } = setup();
    install(v1());
    const registryBefore = text(REGISTRY_PATH);
    failNext('rename', '.stage-demo-skill');
    // Act / Assert
    expect(() => install(v2())).toThrow(/restaurado la versión anterior/);
    expect(text(join(TARGET_ROOT, 'SKILL.md'))).toBe('hola v1');
    expect(fs.exists(join(TARGET_ROOT, 'scripts/run.sh'))).toBe(true);
    expect(text(REGISTRY_PATH)).toBe(registryBefore);
    expect(hasLeftovers(files)).toBe(false);
  });

  it('installOwnedFiles_corruptRegistry_throwsWithoutWriting', () => {
    // Arrange
    const { put, text, install, fs } = setup();
    put(REGISTRY_PATH, '{roto');
    // Act / Assert
    expect(() => install(v1())).toThrow(/corrupto/);
    expect(fs.exists(TARGET_ROOT)).toBe(false);
    expect(text(REGISTRY_PATH)).toBe('{roto');
  });
});

describe('uninstallOwnedFiles', () => {
  it('uninstallOwnedFiles_intactFiles_removesFilesAndKeepsOtherEntries', () => {
    // Arrange
    const { ctx, install, fs } = setup();
    install(v1());
    const other = { packageId: 'otro-paquete', engine: 'claude', scope: 'user', absPath: join(ROOT, 'otra', 'x.md'), sha256: 'c'.repeat(64) };
    const registry = loadOwnershipRegistry(ctx.fs, REGISTRY_PATH);
    ctx.fs.writeFile(REGISTRY_PATH, Buffer.from(JSON.stringify({ ...registry, entries: [...registry.entries, other] })));
    // Act
    const result = uninstallOwnedFiles(ctx, REF);
    // Assert
    expect(result).toEqual({
      status: 'uninstalled',
      removed: [join(TARGET_ROOT, 'SKILL.md'), join(TARGET_ROOT, 'scripts/run.sh')],
    });
    expect(fs.exists(join(TARGET_ROOT, 'SKILL.md'))).toBe(false);
    expect(fs.exists(join(TARGET_ROOT, 'scripts/run.sh'))).toBe(false);
    expect(loadOwnershipRegistry(ctx.fs, REGISTRY_PATH).entries).toEqual([other]);
  });

  it('uninstallOwnedFiles_modifiedFile_returnsModifiedByUserAndDeletesNothing', () => {
    // Arrange
    const { ctx, put, text, install, fs } = setup();
    install(v1());
    const script = join(TARGET_ROOT, 'scripts/run.sh');
    put(script, 'echo del usuario');
    const registryBefore = text(REGISTRY_PATH);
    // Act
    const result = uninstallOwnedFiles(ctx, REF);
    // Assert
    expect(result).toEqual({ status: 'modifiedByUser', paths: [script] });
    expect(fs.exists(join(TARGET_ROOT, 'SKILL.md'))).toBe(true);
    expect(fs.exists(script)).toBe(true);
    expect(text(REGISTRY_PATH)).toBe(registryBefore);
  });

  it('uninstallOwnedFiles_ownFileAlreadyMissing_removesEntry', () => {
    // Arrange
    const { ctx, install, fs } = setup();
    install(v1());
    fs.removeFile(join(TARGET_ROOT, 'SKILL.md'));
    // Act
    const result = uninstallOwnedFiles(ctx, REF);
    // Assert
    expect(result).toEqual({ status: 'uninstalled', removed: [join(TARGET_ROOT, 'scripts/run.sh')] });
    expect(loadOwnershipRegistry(ctx.fs, REGISTRY_PATH).entries).toEqual([]);
  });

  it('uninstallOwnedFiles_notRegistered_returnsNotInstalled', () => {
    // Arrange
    const { ctx } = setup();
    // Act
    const result = uninstallOwnedFiles(ctx, REF);
    // Assert
    expect(result).toEqual({ status: 'notInstalled' });
  });

  it('uninstallOwnedFiles_otherScope_returnsNotInstalled', () => {
    // Arrange
    const { ctx, install, fs } = setup();
    install(v1());
    // Act
    const result = uninstallOwnedFiles(ctx, { ...REF, scope: 'project' });
    // Assert
    expect(result).toEqual({ status: 'notInstalled' });
    expect(fs.exists(join(TARGET_ROOT, 'SKILL.md'))).toBe(true);
  });
});

describe('recoverInterruptedUpdate', () => {
  it('recoverInterruptedUpdate_noLeftovers_returnsClean', () => {
    // Arrange
    const { ctx } = setup();
    // Act
    const outcome = recoverInterruptedUpdate(ctx, REF);
    // Assert
    expect(outcome).toBe('clean');
  });

  it('recoverInterruptedUpdate_staleStage_removesStageReturnsClean', () => {
    // Arrange
    const { ctx, put, fs } = setup();
    put(join(STAGE, 'SKILL.md'), 'a medias');
    // Act
    const outcome = recoverInterruptedUpdate(ctx, REF);
    // Assert
    expect(outcome).toBe('clean');
    expect(fs.exists(STAGE)).toBe(false);
  });

  it('recoverInterruptedUpdate_previousAndIntactTarget_removesPreviousReturnsCommitted', () => {
    // Arrange
    const { ctx, put, text, install, fs } = setup();
    install(v1());
    put(join(PREVIOUS, 'SKILL.md'), 'viejo');
    // Act
    const outcome = recoverInterruptedUpdate(ctx, REF);
    // Assert
    expect(outcome).toBe('committed');
    expect(fs.exists(PREVIOUS)).toBe(false);
    expect(text(join(TARGET_ROOT, 'SKILL.md'))).toBe('hola v1');
  });

  it('recoverInterruptedUpdate_previousAndMissingTarget_restoresPreviousReturnsRolledBack', () => {
    // Arrange
    const { ctx, put, text, install, fs } = setup();
    install(v1());
    fs.removeTree(TARGET_ROOT);
    put(join(PREVIOUS, 'SKILL.md'), 'hola v1');
    put(join(PREVIOUS, 'scripts/run.sh'), 'echo v1');
    // Act
    const outcome = recoverInterruptedUpdate(ctx, REF);
    // Assert
    expect(outcome).toBe('rolledBack');
    expect(text(join(TARGET_ROOT, 'SKILL.md'))).toBe('hola v1');
  });
});
