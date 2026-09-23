import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVersionEnv, parseClaudeVersion } from './claudeVersion';

describe('parseClaudeVersion', () => {
  it('parse_typicalOutput_extractsVersion', () => {
    expect(parseClaudeVersion('2.1.205 (Claude Code)')).toBe('2.1.205');
  });

  it('parse_bareVersion_extractsVersion', () => {
    expect(parseClaudeVersion('2.1.205')).toBe('2.1.205');
  });

  it('parse_withNoise_extractsVersion', () => {
    expect(parseClaudeVersion('claude version 2.3.0 built 2026')).toBe('2.3.0');
  });

  it('parse_prereleaseSuffix_keepsSuffix', () => {
    expect(parseClaudeVersion('3.0.0-beta.2')).toBe('3.0.0-beta.2');
  });

  it('parse_empty_returnsNull', () => {
    expect(parseClaudeVersion('')).toBeNull();
  });

  it('parse_noVersion_returnsNull', () => {
    expect(parseClaudeVersion('command not found')).toBeNull();
  });
});

describe('buildVersionEnv', () => {
  it('buildVersionEnv_inheritedApiKey_removesIt', () => {
    // Invariante de facturacion: ningun hijo `claude` puede ver ANTHROPIC_API_KEY.
    const env = buildVersionEnv({ ANTHROPIC_API_KEY: 'sk-ant-heredada' }, '/home/u');

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('buildVersionEnv_inheritedConfigDir_replacesWithMainAccount', () => {
    const env = buildVersionEnv({ CLAUDE_CONFIG_DIR: '/home/u/.claude-9/mage-private' }, '/home/u');

    expect(env.CLAUDE_CONFIG_DIR).toBe(join('/home/u', '.claude'));
  });

  it('buildVersionEnv_otherVariables_arePreserved', () => {
    const env = buildVersionEnv({ PATH: '/usr/bin', LANG: 'es_ES.UTF-8' }, '/home/u');

    expect(env.PATH).toBe('/usr/bin');
    expect(env.LANG).toBe('es_ES.UTF-8');
  });

  it('buildVersionEnv_doesNotMutateTheBaseEnv', () => {
    const base = { ANTHROPIC_API_KEY: 'sk-ant-heredada' };

    buildVersionEnv(base, '/home/u');

    expect(base.ANTHROPIC_API_KEY).toBe('sk-ant-heredada');
  });
});
