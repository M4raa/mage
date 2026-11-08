import { describe, expect, it } from 'vitest';
import catalogJson from './catalog.json';
import {
  bundledContents,
  loadBundledCatalog,
  parseLibraryCatalog,
  type EccContent,
  type LibraryCatalogEntry,
} from './libraryCatalog';
import { sha256Hex } from '../ownedFilesInstaller';

const ECC_COMMIT = 'c05b2d6614f62f6db0047669aa4eefb223d478f9';

type RawCatalog = { version: number; entries: Record<string, any>[] };
const rawCopy = (): RawCatalog => structuredClone(catalogJson) as unknown as RawCatalog;
const byId = (id: string): LibraryCatalogEntry => {
  const entry = loadBundledCatalog().find((e) => e.id === id);
  if (entry === undefined) throw new Error(`Falta ${id} en el catálogo de prueba`);
  return entry;
};

describe('parseLibraryCatalog', () => {
  it('parseLibraryCatalog_bundledCatalog_parsesThirteenEntries', () => {
    // Arrange / Act
    const entries = parseLibraryCatalog(catalogJson);
    // Assert
    expect(entries).toHaveLength(13);
    expect(entries[0]?.id).toBe('ecc-tdd-workflow');
    expect(entries[12]?.id).toBe('firecrawl-mcp');
  });

  it('parseLibraryCatalog_duplicatedId_throwsWithId', () => {
    // Arrange
    const raw = rawCopy();
    raw.entries[1]!.package.id = raw.entries[0]!.package.id;
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow(/id repetido ecc-tdd-workflow/);
  });

  it('parseLibraryCatalog_licenseMismatch_throws', () => {
    // Arrange
    const raw = rawCopy();
    raw.entries[0]!.license.spdx = 'Apache-2.0';
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow(/no es la del paquete/);
  });

  it('parseLibraryCatalog_copiedWithoutContentPrefix_throws', () => {
    // Arrange
    const raw = rawCopy();
    delete raw.entries[0]!.contentPrefix;
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow(/contentPrefix/);
  });

  it('parseLibraryCatalog_linkedWithFiles_throws', () => {
    // Arrange
    const raw = rawCopy();
    const ecc = raw.entries.find((e) => e.package.id === 'ecc')!;
    ecc.package.files = [{ relPath: 'x.md', sha256: '0'.repeat(64) }];
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow(/lo enlazado/);
  });

  it('parseLibraryCatalog_impossibleRetrievedAt_throws', () => {
    // Arrange
    const raw = rawCopy();
    raw.entries[0]!.provenance.retrievedAt = '2026-02-30';
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow();
  });

  it('parseLibraryCatalog_httpProvenance_throws', () => {
    // Arrange
    const raw = rawCopy();
    raw.entries[0]!.provenance.repo = 'http://example.com';
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow();
  });

  it('parseLibraryCatalog_wrongVersion_throwsWithValue', () => {
    // Arrange
    const raw = rawCopy();
    raw.version = 2;
    // Act / Assert
    expect(() => parseLibraryCatalog(raw)).toThrow(/Catálogo de la biblioteca inválido/);
  });

  it('parseLibraryCatalog_null_throws', () => {
    // Arrange / Act / Assert
    expect(() => parseLibraryCatalog(null)).toThrow(/Catálogo de la biblioteca inválido/);
  });
});

describe('loadBundledCatalog', () => {
  it('loadBundledCatalog_everyEntry_hasPinnedVersionAndHttpsProvenance', () => {
    // Arrange / Act
    const entries = loadBundledCatalog();
    // Assert
    for (const entry of entries) {
      expect(entry.package.version).not.toMatch(/latest|\^|~|\*/);
      expect(entry.provenance.repo.startsWith('https://')).toBe(true);
    }
    const ecc = entries.filter((e) => e.provenance.repo.includes('affaan-m/ECC'));
    expect(ecc.length).toBeGreaterThan(0);
    expect(ecc.every((e) => e.provenance.commit === ECC_COMMIT)).toBe(true);
  });

  it('loadBundledCatalog_everyLicense_isMitWithHttpsUrl', () => {
    // Arrange / Act
    const entries = loadBundledCatalog();
    // Assert
    expect(entries.every((e) => e.license.spdx === 'MIT' && e.license.url.startsWith('https://'))).toBe(true);
  });

  it('loadBundledCatalog_mcpArgs_pinExactNpmVersion', () => {
    // Arrange
    const mcps = loadBundledCatalog().filter((e) => e.package.kind === 'mcp');
    // Act / Assert
    expect(mcps.length).toBeGreaterThan(0);
    for (const entry of mcps) {
      const native = entry.package.native;
      const last = native?.type === 'mcpStdio' ? native.args.at(-1) : undefined;
      expect(last?.endsWith(`@${entry.package.version}`)).toBe(true);
    }
  });
});

describe('bundledContents', () => {
  it('bundledContents_everyCopiedEntry_matchesPackageHashes', () => {
    // Arrange
    const copied = loadBundledCatalog().filter((e) => e.distribution === 'copied');
    // Act / Assert
    expect(copied).toHaveLength(9);
    for (const entry of copied) {
      const contents = bundledContents(entry);
      for (const file of entry.package.files) {
        expect(sha256Hex(contents.get(file.relPath) as Buffer), `${entry.id}/${file.relPath}`).toBe(file.sha256);
      }
    }
  });

  it('bundledContents_linkedEntry_throws', () => {
    // Arrange / Act / Assert
    expect(() => bundledContents(byId('ecc'))).toThrow(/ecc no es contenido copiado/);
  });

  it('bundledContents_missingFile_throwsWithPath', () => {
    // Arrange
    const empty: EccContent = { license: { text: 'MIT' }, files: {} };
    // Act / Assert
    expect(() => bundledContents(byId('ecc-tdd-workflow'), empty)).toThrow(/SKILL\.md/);
  });
});
