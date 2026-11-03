import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledContents, loadBundledCatalog, type LibraryCatalogEntry } from './libraryCatalog';
import { formatCommand, installBlockFor, previewInstall } from './libraryPreview';

const accountDir = join(tmpdir(), 'mage-p01', '.claude-x');
const byId = (id: string): LibraryCatalogEntry => {
  const entry = loadBundledCatalog().find((e) => e.id === id);
  if (entry === undefined) throw new Error(`Falta ${id} en el catálogo de prueba`);
  return entry;
};

describe('previewInstall', () => {
  it('previewInstall_claudeSkill_listsFilesUnderAccountSkillsDir', () => {
    // Arrange
    const entry = byId('ecc-tdd-workflow');
    // Act
    const preview = previewInstall({ entry, engine: 'claude', accountDir, platform: 'linux' }, bundledContents(entry));
    // Assert
    const root = join(accountDir, 'skills', 'ecc-tdd-workflow');
    expect(preview.route).toBe('ownedFiles');
    expect(preview.files.map((f) => f.absPath)).toEqual([join(root, 'SKILL.md'), join(root, 'LICENSE')]);
    expect(preview.files.every((f) => f.bytes > 0)).toBe(true);
    expect(preview.commands).toEqual([]);
    expect(preview.envVar).toBe('CLAUDE_CONFIG_DIR');
    expect(preview.runsCode).toBe(false);
  });

  it('previewInstall_codexSkill_blockedCodexSkillsUnmeasured', () => {
    // Arrange
    const entry = byId('ecc-tdd-workflow');
    // Act
    const preview = previewInstall({ entry, engine: 'codex', accountDir, platform: 'linux' }, bundledContents(entry));
    // Assert
    expect(preview).toMatchObject({
      block: 'codexSkillsUnmeasured',
      route: null,
      files: [],
      commands: [],
      envVar: 'CODEX_HOME',
    });
  });

  it('previewInstall_mcpWithSecrets_blockedNeedsSecrets', () => {
    // Arrange
    const entry = byId('exa-mcp');
    // Act
    const preview = previewInstall({ entry, engine: 'claude', accountDir, platform: 'linux' }, null);
    // Assert
    expect(preview.block).toBe('needsSecrets');
    expect(preview.requiresSecrets).toEqual(['EXA_API_KEY']);
  });

  it('previewInstall_context7OnWindows_wrapsNpxInCmd', () => {
    // Arrange
    const entry = byId('context7');
    // Act
    const preview = previewInstall({ entry, engine: 'claude', accountDir, platform: 'win32' }, null);
    // Assert
    expect(preview.commands).toEqual([
      'claude mcp add --scope user --transport stdio context7 -- cmd /c npx -y @upstash/context7-mcp@4.4.2',
    ]);
    expect(preview.requiresCommands).toEqual(['npx']);
    expect(preview.runsCode).toBe(true);
  });

  it('previewInstall_context7OnLinux_runsNpxDirectly', () => {
    // Arrange
    const entry = byId('context7');
    // Act
    const preview = previewInstall({ entry, engine: 'codex', accountDir, platform: 'linux' }, null);
    // Assert
    expect(preview.commands).toEqual(['codex mcp add context7 -- npx -y @upstash/context7-mcp@4.4.2']);
  });

  it('previewInstall_eccPluginClaude_pinsMarketplaceRef', () => {
    // Arrange
    const entry = byId('ecc');
    // Act
    const preview = previewInstall({ entry, engine: 'claude', accountDir, platform: 'darwin' }, null);
    // Assert
    expect(preview.commands).toEqual([
      'claude plugin marketplace add https://github.com/affaan-m/ECC.git#v2.2.3',
      'claude plugin install ecc@ecc --scope user',
    ]);
    expect(preview.components).toHaveLength(4);
    expect(preview.components.some((c) => c.engine === 'codex')).toBe(false);
  });

  it('previewInstall_eccPluginCodex_pinsMarketplaceRefFlag', () => {
    // Arrange
    const entry = byId('ecc');
    // Act
    const preview = previewInstall({ entry, engine: 'codex', accountDir, platform: 'linux' }, null);
    // Assert
    expect(preview.commands).toEqual([
      'codex plugin marketplace add https://github.com/affaan-m/ECC.git --ref v2.2.3',
      'codex plugin add ecc@ecc',
    ]);
    expect(preview.components).toHaveLength(3);
    expect(preview.components).toContainEqual({ engine: 'codex', kind: 'mcp', names: ['chrome-devtools'] });
  });

  it('previewInstall_relativeAccountDir_throwsWithValue', () => {
    // Arrange
    const entry = byId('context7');
    // Act / Assert
    expect(() => previewInstall({ entry, engine: 'claude', accountDir: '.claude', platform: 'linux' }, null)).toThrow(
      /"\.claude"/,
    );
  });

  it('previewInstall_ownedFilesWithoutContents_throws', () => {
    // Arrange
    const entry = byId('ecc-tdd-workflow');
    // Act / Assert
    expect(() => previewInstall({ entry, engine: 'claude', accountDir, platform: 'linux' }, null)).toThrow(
      /ecc-tdd-workflow/,
    );
  });
});

describe('installBlockFor', () => {
  it('installBlockFor_platformNotListed_returnsPlatformUnsupported', () => {
    // Arrange
    const entry = { ...byId('context7'), platforms: ['linux' as const] };
    // Act / Assert
    expect(installBlockFor(entry, 'claude', 'win32')).toBe('platformUnsupported');
  });

  it('installBlockFor_engineNotDeclared_returnsEngineNotDeclared', () => {
    // Arrange
    const base = byId('context7');
    const entry = { ...base, package: { ...base.package, engines: ['claude' as const] } };
    // Act / Assert
    expect(installBlockFor(entry, 'codex', 'linux')).toBe('engineNotDeclared');
  });

  it('installBlockFor_context7Claude_returnsNull', () => {
    // Arrange / Act / Assert
    expect(installBlockFor(byId('context7'), 'claude', 'linux')).toBeNull();
  });
});

describe('formatCommand', () => {
  it('formatCommand_argWithSpace_quotesIt', () => {
    // Arrange / Act
    const text = formatCommand({ engine: 'claude', args: ['mcp', 'add', 'a b'] });
    // Assert
    expect(text).toBe('claude mcp add "a b"');
  });
});
