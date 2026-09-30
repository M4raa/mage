import { describe, expect, it } from 'vitest';
import { BLOCKED_AGENT_ENV_VARS, scrubAgentEnv } from './agentEnv';

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
