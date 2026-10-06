import { describe, expect, it } from 'vitest';
import { scrubAgentEnv } from '../../src/main/os/agentEnv.ts';
import { loginEnvironment } from '../../spike/codex-verification.mjs';

describe('loginEnvironment', () => {
  it('loginEnvironment_clavesHeredadas_saneaAntesDeAñadirLaUrl', () => {
    const baseEnv = { OPENAI_API_KEY: 'artificial-openai', ANTHROPIC_AUTH_TOKEN: 'artificial-anthropic', MAGE_CODEX_API_KEY: 'artificial-mage', PATH: 'test-path' };
    const deps = { baseEnv, scrubAgentEnv };

    const result = loginEnvironment('owned-home', 'https://auth.openai.com/test', deps);

    expect(result).toEqual({ PATH: 'test-path', CODEX_HOME: 'owned-home', MAGE_CODEX_LOGIN_URL: 'https://auth.openai.com/test' });
    expect(baseEnv.OPENAI_API_KEY).toBe('artificial-openai');
  });
});
