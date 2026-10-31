import { describe, expect, it } from 'vitest';
import { isSafeRelPath, parseCapabilityPackage } from './capabilityPackage';

function validSkill(): Record<string, unknown> {
  return {
    id: 'demo-skill',
    version: '1.0.0',
    source: { url: 'https://example.com/demo.tgz', sha256: 'a'.repeat(64) },
    license: 'MIT',
    kind: 'skill',
    engines: ['claude'],
    files: [{ relPath: 'SKILL.md', sha256: 'b'.repeat(64) }],
  };
}

function validMcp(): Record<string, unknown> {
  return {
    ...validSkill(),
    id: 'demo-mcp',
    kind: 'mcp',
    files: [],
    native: { type: 'mcpStdio', name: 'demo', command: 'node', args: ['server.js'] },
  };
}

function skillWithRelPath(relPath: string): Record<string, unknown> {
  return { ...validSkill(), files: [{ relPath, sha256: 'b'.repeat(64) }] };
}

describe('parseCapabilityPackage', () => {
  it('parseCapabilityPackage_validSkill_returnsTypedPackage', () => {
    // Arrange
    const raw = validSkill();
    // Act
    const pkg = parseCapabilityPackage(raw);
    // Assert
    expect(pkg.id).toBe('demo-skill');
    expect(pkg.requires).toEqual({});
    expect(pkg.native).toBeUndefined();
  });

  it('parseCapabilityPackage_validMcpWithNative_returnsNative', () => {
    // Arrange
    const raw = validMcp();
    // Act
    const pkg = parseCapabilityPackage(raw);
    // Assert
    expect(pkg.native).toEqual({ type: 'mcpStdio', name: 'demo', command: 'node', args: ['server.js'] });
  });

  it('parseCapabilityPackage_mcpNativeWithoutArgs_defaultsToEmptyArgs', () => {
    // Arrange
    const raw = { ...validMcp(), native: { type: 'mcpStdio', name: 'demo', command: 'node' } };
    // Act
    const pkg = parseCapabilityPackage(raw);
    // Assert
    expect(pkg.native).toMatchObject({ args: [] });
  });

  it('parseCapabilityPackage_null_throwsWithReceivedValue', () => {
    // Arrange / Act / Assert
    expect(() => parseCapabilityPackage(null)).toThrow(/null/);
  });

  it('parseCapabilityPackage_emptyObject_throws', () => {
    // Arrange / Act / Assert
    expect(() => parseCapabilityPackage({})).toThrow(/\{\}/);
  });

  it('parseCapabilityPackage_relPathWithParentSegment_throws', () => {
    // Arrange
    const raw = skillWithRelPath('../x.md');
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/relPath inseguro/);
  });

  it.each(['/etc/passwd', 'C:/x.md'])('parseCapabilityPackage_absoluteRelPath_throws (%s)', (relPath) => {
    // Arrange
    const raw = skillWithRelPath(relPath);
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/relPath inseguro/);
  });

  it('parseCapabilityPackage_backslashRelPath_throws', () => {
    // Arrange
    const raw = skillWithRelPath('a\\b.md');
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/relPath inseguro/);
  });

  it('parseCapabilityPackage_emptySegmentRelPath_throws', () => {
    // Arrange
    const raw = skillWithRelPath('a//b.md');
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/relPath inseguro/);
  });

  it('parseCapabilityPackage_duplicateRelPathIgnoringCase_throws', () => {
    // Arrange
    const raw = {
      ...validSkill(),
      files: [
        { relPath: 'SKILL.md', sha256: 'b'.repeat(64) },
        { relPath: 'skill.md', sha256: 'c'.repeat(64) },
      ],
    };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/relPath repetido/);
  });

  it.each(['A'.repeat(64), 'a'.repeat(63)])('parseCapabilityPackage_badSha256_throws (%s)', (sha) => {
    // Arrange
    const raw = { ...validSkill(), files: [{ relPath: 'SKILL.md', sha256: sha }] };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/files\.0\.sha256/);
  });

  it('parseCapabilityPackage_emptyEngines_throws', () => {
    // Arrange
    const raw = { ...validSkill(), engines: [] };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/engines/);
  });

  it('parseCapabilityPackage_repeatedEngines_throws', () => {
    // Arrange
    const raw = { ...validSkill(), engines: ['claude', 'claude'] };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/engines repetidos/);
  });

  it('parseCapabilityPackage_mcpWithoutNative_throws', () => {
    // Arrange
    const { native: _native, ...raw } = validMcp();
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/necesita native/);
  });

  it('parseCapabilityPackage_skillWithNative_throws', () => {
    // Arrange
    const raw = { ...validSkill(), native: validMcp().native };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/native solo vale/);
  });

  it('parseCapabilityPackage_skillWithoutFiles_throws', () => {
    // Arrange
    const raw = { ...validSkill(), files: [] };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/necesita ficheros/);
  });

  it('parseCapabilityPackage_idWithSlash_throws', () => {
    // Arrange
    const raw = { ...validSkill(), id: 'a/b' };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/a\/b/);
  });

  it('parseCapabilityPackage_uppercaseId_throws', () => {
    // Arrange
    const raw = { ...validSkill(), id: 'Demo' };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/Demo/);
  });

  it('parseCapabilityPackage_marketplaceSourceStartingWithDash_throws', () => {
    // Arrange
    const raw = {
      ...validSkill(),
      kind: 'plugin',
      files: [],
      native: { type: 'plugin', name: 'p', marketplace: { name: 'm', source: '--evil' } },
    };
    // Act / Assert
    expect(() => parseCapabilityPackage(raw)).toThrow(/source no puede empezar/);
  });

  it('parseCapabilityPackage_longValue_truncatesPreview', () => {
    // Arrange
    const raw = { id: 'x'.repeat(1000) };
    // Act
    let message = '';
    try {
      parseCapabilityPackage(raw);
    } catch (err) {
      message = (err as Error).message;
    }
    // Assert
    expect(message.length).toBeGreaterThan(0);
    expect(message.length).toBeLessThan(600);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('isSafeRelPath', () => {
  it('isSafeRelPath_nestedPath_returnsTrue', () => {
    // Arrange / Act / Assert
    expect(isSafeRelPath('scripts/run.sh')).toBe(true);
  });
});
