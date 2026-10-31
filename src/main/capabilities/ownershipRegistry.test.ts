import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryCapabilityFs } from './memoryCapabilityFs';
import {
  loadOwnershipRegistry,
  ownershipRegistryPath,
  saveOwnershipRegistry,
  type OwnershipEntry,
  type OwnershipRegistry,
} from './ownershipRegistry';

const REGISTRY_PATH = join(resolve('/ud'), 'capabilities', 'ownership.json');

function sampleRegistry(): OwnershipRegistry {
  return {
    version: 1,
    entries: [
      {
        packageId: 'demo-skill',
        engine: 'claude',
        scope: 'user',
        absPath: join(resolve('/cfg'), 'SKILL.md'),
        sha256: 'a'.repeat(64),
      },
    ],
  };
}

describe('ownershipRegistryPath', () => {
  it('ownershipRegistryPath_absoluteUserData_returnsCapabilitiesOwnershipJson', () => {
    // Arrange
    const userData = resolve('/ud');
    // Act
    const path = ownershipRegistryPath(userData);
    // Assert
    expect(path).toBe(join(userData, 'capabilities', 'ownership.json'));
  });

  it.each(['', '   ', 'relativo/dir'])('ownershipRegistryPath_emptyUserData_throws (%j)', (userData) => {
    // Arrange / Act / Assert
    expect(() => ownershipRegistryPath(userData)).toThrow(JSON.stringify(userData));
  });
});

describe('loadOwnershipRegistry', () => {
  it('loadOwnershipRegistry_missingFile_returnsEmptyV1', () => {
    // Arrange
    const { fs } = createMemoryCapabilityFs();
    // Act
    const registry = loadOwnershipRegistry(fs, REGISTRY_PATH);
    // Assert
    expect(registry).toEqual({ version: 1, entries: [] });
  });

  it('loadOwnershipRegistry_validFile_returnsEntries', () => {
    // Arrange
    const { fs, put } = createMemoryCapabilityFs();
    put(REGISTRY_PATH, JSON.stringify(sampleRegistry()));
    // Act
    const registry = loadOwnershipRegistry(fs, REGISTRY_PATH);
    // Assert
    expect(registry).toEqual(sampleRegistry());
  });

  it('loadOwnershipRegistry_emptyFile_throwsWithReceivedValue', () => {
    // Arrange
    const { fs, put } = createMemoryCapabilityFs();
    put(REGISTRY_PATH, '');
    // Act
    const act = (): unknown => loadOwnershipRegistry(fs, REGISTRY_PATH);
    // Assert
    expect(act).toThrow(/corrupto/);
    expect(act).toThrow(REGISTRY_PATH);
  });

  it('loadOwnershipRegistry_invalidJson_throwsWithReceivedValue', () => {
    // Arrange
    const { fs, put } = createMemoryCapabilityFs();
    put(REGISTRY_PATH, '{no json');
    // Act / Assert
    expect(() => loadOwnershipRegistry(fs, REGISTRY_PATH)).toThrow('{no json');
  });

  it('loadOwnershipRegistry_emptyObject_throws', () => {
    // Arrange
    const { fs, put } = createMemoryCapabilityFs();
    put(REGISTRY_PATH, '{}');
    // Act / Assert
    expect(() => loadOwnershipRegistry(fs, REGISTRY_PATH)).toThrow(/corrupto/);
  });

  it('loadOwnershipRegistry_unknownVersion_throws', () => {
    // Arrange
    const { fs, put } = createMemoryCapabilityFs();
    put(REGISTRY_PATH, '{"version":2,"entries":[]}');
    // Act / Assert
    expect(() => loadOwnershipRegistry(fs, REGISTRY_PATH)).toThrow(/corrupto/);
  });

  it('loadOwnershipRegistry_entryWithoutSha_throws', () => {
    // Arrange
    const { fs, put } = createMemoryCapabilityFs();
    const { sha256: _sha, ...entry } = sampleRegistry().entries[0] as OwnershipEntry;
    put(REGISTRY_PATH, JSON.stringify({ version: 1, entries: [entry] }));
    // Act / Assert
    expect(() => loadOwnershipRegistry(fs, REGISTRY_PATH)).toThrow(/sha256/);
  });
});

describe('saveOwnershipRegistry', () => {
  it('saveOwnershipRegistry_registry_roundTripsWithoutTempLeft', () => {
    // Arrange
    const { fs, files } = createMemoryCapabilityFs();
    // Act
    saveOwnershipRegistry(fs, REGISTRY_PATH, sampleRegistry());
    const loaded = loadOwnershipRegistry(fs, REGISTRY_PATH);
    // Assert
    expect(loaded).toEqual(sampleRegistry());
    expect([...files.keys()]).toEqual([REGISTRY_PATH]);
  });
});
