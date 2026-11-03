import { describe, expect, it } from 'vitest';
import { BLOCKED_AGENT_ENV_VARS, decideTestAnthropicBaseUrl, scrubAgentEnv } from './agentEnv';

describe('decideTestAnthropicBaseUrl', () => {
  const base = { value: 'http://127.0.0.1:4567', isPackaged: false, isApiKeyAccount: true };

  it('decideTestAnthropicBaseUrl_missing_none', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, value: undefined })).toEqual({ kind: 'none' });
    expect(decideTestAnthropicBaseUrl({ ...base, value: '  ' })).toEqual({ kind: 'none' });
  });

  it('decideTestAnthropicBaseUrl_packaged_ignored', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, isPackaged: true })).toEqual({ kind: 'ignored', reason: 'packaged' });
  });

  it('decideTestAnthropicBaseUrl_remoteHost_ignoredNotLoopback', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, value: 'http://example.com:8080' })).toEqual({ kind: 'ignored', reason: 'not_loopback' });
  });

  it('decideTestAnthropicBaseUrl_https_ignoredNotLoopback', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, value: 'https://127.0.0.1:4567' })).toEqual({ kind: 'ignored', reason: 'not_loopback' });
  });

  it('decideTestAnthropicBaseUrl_garbage_ignoredNotLoopback', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, value: 'no es una url' })).toEqual({ kind: 'ignored', reason: 'not_loopback' });
  });

  it('decideTestAnthropicBaseUrl_subscription_ignoredNotApiAccount', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, isApiKeyAccount: false })).toEqual({ kind: 'ignored', reason: 'not_api_account' });
  });

  it('decideTestAnthropicBaseUrl_loopbackApiAccount_useOrigin', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, value: 'http://127.0.0.1:4567/v1/' })).toEqual({ kind: 'use', url: 'http://127.0.0.1:4567' });
  });

  it('decideTestAnthropicBaseUrl_localhostAndIpv6_use', () => {
    expect(decideTestAnthropicBaseUrl({ ...base, value: 'http://localhost:1234' })).toEqual({ kind: 'use', url: 'http://localhost:1234' });
    expect(decideTestAnthropicBaseUrl({ ...base, value: 'http://[::1]:1234' })).toEqual({ kind: 'use', url: 'http://[::1]:1234' });
  });
});

describe('scrubAgentEnv', () => {
  it('scrubAgentEnv_conCredencialesDeProveedor_lasBorraTodas', () => {
    const base: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://proxy.ajeno.example',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      GEMINI_API_KEY: 'g',
      GOOGLE_API_KEY: 'gg',
      OPENAI_API_KEY: 'sk-openai',
      CODEX_API_KEY: 'sk-codex',
    };

    const env = scrubAgentEnv(base);

    for (const name of BLOCKED_AGENT_ENV_VARS) expect(env[name]).toBeUndefined();
  });

  it('scrubAgentEnv_clavesDeOpenAi_estanEnLaListaYNoLleganAlHijo', () => {
    // `codex` factura la API con cualquiera de las dos: no puede heredarlas ningun hijo.
    const env = scrubAgentEnv({ OPENAI_API_KEY: 'sk-openai', CODEX_API_KEY: 'sk-codex', PATH: '/usr/bin' });

    expect(BLOCKED_AGENT_ENV_VARS).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'CODEX_API_KEY']));
    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('scrubAgentEnv_testBaseUrlVar_removed', () => {
    const env = scrubAgentEnv({ MAGE_TEST_ANTHROPIC_BASE_URL: 'http://127.0.0.1:1234', PATH: '/usr/bin' });

    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('scrubAgentEnv_mageMcpCaller_removed', () => {
    const env = scrubAgentEnv({ MAGE_MCP_CALLER: 'a'.repeat(64), PATH: '/usr/bin' });

    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('scrubAgentEnv_conVariablesInocentes_lasConserva', () => {
    // La lista es NEGRA (decision A3): lo que el entorno necesite para funcionar tiene que pasar.
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/u', HTTPS_PROXY: 'http://proxy:8080', LANG: 'es_ES.UTF-8' };

    const env = scrubAgentEnv(base);

    expect(env).toEqual(base);
  });

  it('scrubAgentEnv_noMutaLaEntrada', () => {
    // Quien llama suele pasar `process.env`: mutarlo afectaria al proceso main entero.
    const base: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-ant-xxx', PATH: '/usr/bin' };

    scrubAgentEnv(base);

    expect(base.ANTHROPIC_API_KEY).toBe('sk-ant-xxx');
  });

  it('scrubAgentEnv_entornoVacio_devuelveVacio', () => {
    expect(scrubAgentEnv({})).toEqual({});
  });

  it('scrubAgentEnv_variablePresenteConValorVacio_igualLaBorra', () => {
    // Una cadena vacia tambien desactiva OAuth en el CLI: no basta con mirar si "tiene valor".
    const env = scrubAgentEnv({ ANTHROPIC_AUTH_TOKEN: '' });

    expect('ANTHROPIC_AUTH_TOKEN' in env).toBe(false);
  });
});
