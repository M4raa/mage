import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCapabilityPackage, type CapabilityEngine, type CapabilityKind, type CapabilityPackage } from './capabilityPackage';
import { claudeSkillRoot, installRouteFor } from './installRoute';

const BASE = {
  id: 'demo-skill',
  version: '1.0.0',
  source: { url: 'https://example.com/demo.tgz', sha256: 'a'.repeat(64) },
  license: 'MIT',
  engines: ['claude'],
  files: [{ relPath: 'SKILL.md', sha256: 'b'.repeat(64) }],
};

function make(kind: CapabilityKind, extra: Record<string, unknown> = {}): CapabilityPackage {
  return parseCapabilityPackage({ ...BASE, kind, ...extra });
}

const MCP_NATIVE = { type: 'mcpStdio', name: 'demo', command: 'node', args: [] };
const PLUGIN_NATIVE = { type: 'plugin', name: 'tool', marketplace: { name: 'mk', source: 'owner/repo' } };
const BOTH = ['claude', 'codex'];

describe('installRouteFor', () => {
  it.each<[CapabilityEngine, CapabilityKind, Record<string, unknown>]>([
    ['claude', 'mcp', { native: MCP_NATIVE }],
    ['codex', 'mcp', { native: MCP_NATIVE }],
    ['claude', 'plugin', { native: PLUGIN_NATIVE }],
    ['codex', 'plugin', { native: PLUGIN_NATIVE }],
  ])('installRouteFor_nativeKinds_returnsNative', (engine, kind, extra) => {
    // Arrange
    const pkg = make(kind, { engines: BOTH, files: [], ...extra });
    // Act / Assert
    expect(installRouteFor(pkg, engine)).toBe('native');
  });

  it('installRouteFor_claudeSkill_returnsOwnedFiles', () => {
    // Arrange
    const pkg = make('skill');
    // Act / Assert
    expect(installRouteFor(pkg, 'claude')).toBe('ownedFiles');
  });

  it('installRouteFor_codexSkill_throwsNotMeasured', () => {
    // Arrange
    const pkg = make('skill', { engines: BOTH });
    // Act / Assert
    expect(() => installRouteFor(pkg, 'codex')).toThrow(/no está medido/i);
  });

  it('installRouteFor_agent_throws', () => {
    // Arrange
    const pkg = make('agent');
    // Act / Assert
    expect(() => installRouteFor(pkg, 'claude')).toThrow(/agentes sueltos/);
  });

  it('installRouteFor_hook_throws', () => {
    // Arrange
    const pkg = make('hook');
    // Act / Assert
    expect(() => installRouteFor(pkg, 'claude')).toThrow(/hook suelto/);
  });

  it('installRouteFor_engineNotDeclared_throws', () => {
    // Arrange
    const pkg = make('skill');
    // Act / Assert
    expect(() => installRouteFor(pkg, 'codex')).toThrow(/codex/);
  });
});

describe('claudeSkillRoot', () => {
  it('claudeSkillRoot_absoluteConfigDir_returnsSkillsDir', () => {
    // Arrange / Act
    const root = claudeSkillRoot(resolve('/c'), 'demo-skill');
    // Assert
    expect(root).toBe(join(resolve('/c'), 'skills', 'demo-skill'));
  });

  it.each(['', 'rel'])('claudeSkillRoot_relativeConfigDir_throws', (configDir) => {
    // Arrange / Act / Assert
    expect(() => claudeSkillRoot(configDir, 'demo-skill')).toThrow(/config dir/);
  });
});
