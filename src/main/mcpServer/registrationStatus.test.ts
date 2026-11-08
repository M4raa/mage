import { describe, expect, it } from 'vitest';
import { claudeConfigHasMageServer, codexConfigHasMageServer, codexHomeHasMageServer } from './registrationStatus';

describe('codexConfigHasMageServer', () => {
  it('codexConfig_withMageTable_true', () => {
    expect(codexConfigHasMageServer('model = "x"\n\n  [mcp_servers.mage]\ncommand = "mage"\n')).toBe(true);
  });
  it('codexConfig_quotedName_true', () => {
    expect(codexConfigHasMageServer('[mcp_servers."mage"]\r\ncommand = "mage"')).toBe(true);
  });
  it('codexConfig_otherServerOnly_false', () => {
    expect(codexConfigHasMageServer('[mcp_servers.other]\ncommand = "x"')).toBe(false);
  });
  it('codexConfig_mageInComment_false', () => {
    expect(codexConfigHasMageServer('# [mcp_servers.mage]')).toBe(false);
  });
  it('codexConfig_empty_false', () => {
    expect(codexConfigHasMageServer('')).toBe(false);
  });
});

describe('claudeConfigHasMageServer', () => {
  it('claudeConfig_withMage_true', () => {
    expect(claudeConfigHasMageServer('{"mcpServers":{"mage":{"command":"mage"}}}')).toBe(true);
  });
  it('claudeConfig_withoutMcpServers_false', () => {
    expect(claudeConfigHasMageServer('{"other":1}')).toBe(false);
  });
  it('claudeConfig_invalidJson_false', () => {
    expect(claudeConfigHasMageServer('{no')).toBe(false);
  });
});

describe('codexHomeHasMageServer', () => {
  const join = (...parts: string[]): string => parts.join('/');
  it('codexHome_missingFile_false', () => {
    const reader = { exists: () => false, read: () => '', join, warn: () => undefined };
    expect(codexHomeHasMageServer('/h', reader)).toBe(false);
  });
  it('codexHome_readError_warnsWithPathAndFalse', () => {
    const warnings: Array<Record<string, unknown>> = [];
    const reader = { exists: () => true, read: (): string => { throw new Error('EACCES'); }, join, warn: (_m: string, d: Record<string, unknown>) => { warnings.push(d); } };
    expect(codexHomeHasMageServer('/h', reader)).toBe(false);
    expect(warnings[0]?.path).toBe('/h/config.toml');
  });
  it('codexHome_withMage_true', () => {
    const reader = { exists: () => true, read: () => '[mcp_servers.mage]', join, warn: () => undefined };
    expect(codexHomeHasMageServer('/h', reader)).toBe(true);
  });
});
