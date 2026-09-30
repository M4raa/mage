import { describe, expect, it } from 'vitest';
import { chatCompletionsUrl } from '@shared/providers';
import { resolveUpstream, type KeyedCustomProvider } from './providerEndpoints';

// Registro y entorno se pasan como DATOS (modulo puro): ni FS ni process.env de verdad.
const NO_PROVIDERS: readonly KeyedCustomProvider[] = [];
const NO_ENV: Readonly<Record<string, string | undefined>> = {};

function ollama(overrides: Partial<KeyedCustomProvider> = {}): KeyedCustomProvider {
  return {
    id: 'custom:ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    hasApiKey: false,
    apiKey: '',
    models: [{ id: 'llama3', label: 'llama3' }],
    ...overrides,
  };
}

describe('resolveUpstream built-in', () => {
  it('resolveUpstream_openaiConKeyEnEntorno_devuelveEndpointYKey', () => {
    const target = resolveUpstream({
      providerId: 'openai',
      model: 'gpt-4o',
      customProviders: NO_PROVIDERS,
      env: { OPENAI_API_KEY: 'sk-real' },
    });

    expect(target).toEqual({ url: 'https://api.openai.com/v1/chat/completions', apiKey: 'sk-real', model: 'gpt-4o' });
  });

  // Comportamiento previo del if/else-if que NO se pierde: un modelo de Claude arrastrado por la sesion
  // se traduce al equivalente del proveedor (antes 'sonnet' -> 'gpt-4o' incrustado en el gateway).
  it('resolveUpstream_openaiConModeloDeClaude_aplicaElAlias', () => {
    const env = { OPENAI_API_KEY: 'sk-real' };

    expect(resolveUpstream({ providerId: 'openai', model: 'sonnet', customProviders: NO_PROVIDERS, env }).model).toBe('gpt-4o');
    expect(resolveUpstream({ providerId: 'openai', model: 'haiku', customProviders: NO_PROVIDERS, env }).model).toBe('gpt-4o-mini');
  });

  it('resolveUpstream_geminiConModeloDeClaude_aplicaSusTresAlias', () => {
    const env = { GEMINI_API_KEY: 'g-key' };

    expect(resolveUpstream({ providerId: 'gemini', model: 'sonnet', customProviders: NO_PROVIDERS, env }).model).toBe('gemini-2.5-flash');
    expect(resolveUpstream({ providerId: 'gemini', model: 'haiku', customProviders: NO_PROVIDERS, env }).model).toBe('gemini-1.5-flash');
    expect(resolveUpstream({ providerId: 'gemini', model: 'opus', customProviders: NO_PROVIDERS, env }).model).toBe('gemini-2.5-pro');
  });

  // La URL de Gemini es '/v1beta/openai': la normalizacion NO puede meterle un '/v1' por su cuenta.
  it('resolveUpstream_gemini_conservaLaRutaDeVersionPropia', () => {
    const target = resolveUpstream({
      providerId: 'gemini',
      model: 'gemini-2.5-pro',
      customProviders: NO_PROVIDERS,
      env: { GEMINI_API_KEY: 'g-key' },
    });

    expect(target.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it('resolveUpstream_keyDeEntornoAusente_lanzaConElNombreDeLaVariable', () => {
    expect(() => resolveUpstream({ providerId: 'openai', model: 'gpt-4o', customProviders: NO_PROVIDERS, env: NO_ENV })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('resolveUpstream_keyDeEntornoEnBlanco_lanzaIgual', () => {
    expect(() =>
      resolveUpstream({ providerId: 'gemini', model: 'gemini-2.5-pro', customProviders: NO_PROVIDERS, env: { GEMINI_API_KEY: '   ' } }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('resolveUpstream_claude_lanzaPorqueEsNativo', () => {
    expect(() => resolveUpstream({ providerId: 'claude', model: 'sonnet', customProviders: NO_PROVIDERS, env: NO_ENV })).toThrow(
      /nativo/,
    );
  });
});

describe('resolveUpstream proveedores del usuario', () => {
  it('resolveUpstream_proveedorDelUsuario_devuelveSuUrlYModeloTalCual', () => {
    const target = resolveUpstream({ providerId: 'custom:ollama', model: 'llama3', customProviders: [ollama()], env: NO_ENV });

    expect(target).toEqual({ url: 'http://localhost:11434/v1/chat/completions', apiKey: '', model: 'llama3' });
  });

  it('resolveUpstream_proveedorDelUsuarioConKey_laDevuelveRecortada', () => {
    const target = resolveUpstream({
      providerId: 'custom:remoto',
      model: 'qwen',
      customProviders: [ollama({ id: 'custom:remoto', apiKey: '  lm-key  ' })],
      env: NO_ENV,
    });

    expect(target.apiKey).toBe('lm-key');
  });

  // Un id del usuario que colisione con uno de serie solo puede venir de un fichero editado a mano: gana
  // el de serie (es el que el resto del motor da por hecho).
  it('resolveUpstream_idQueColisionaConUnoDeSerie_ganaElDeSerie', () => {
    const target = resolveUpstream({
      providerId: 'openai',
      model: 'gpt-4o',
      customProviders: [ollama({ id: 'openai', baseUrl: 'http://pirata.local/v1' })],
      env: { OPENAI_API_KEY: 'sk-real' },
    });

    expect(target.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('resolveUpstream_proveedorDesconocido_lanzaConElValorRecibido', () => {
    expect(() => resolveUpstream({ providerId: 'inventado', model: 'x', customProviders: [ollama()], env: NO_ENV })).toThrow(
      /"inventado"/,
    );
  });

  it('resolveUpstream_sinProveedor_lanza', () => {
    expect(() => resolveUpstream({ providerId: '   ', model: 'x', customProviders: NO_PROVIDERS, env: NO_ENV })).toThrow(
      /no declara proveedor/,
    );
  });

  it('resolveUpstream_sinModelo_lanzaConElProveedor', () => {
    expect(() => resolveUpstream({ providerId: 'custom:ollama', model: '', customProviders: [ollama()], env: NO_ENV })).toThrow(
      /"custom:ollama"/,
    );
  });

  it('resolveUpstream_urlBaseInvalida_lanzaConLaUrlRecibida', () => {
    expect(() =>
      resolveUpstream({ providerId: 'custom:ollama', model: 'llama3', customProviders: [ollama({ baseUrl: 'no-es-url' })], env: NO_ENV }),
    ).toThrow(/"no-es-url"/);
  });
});

describe('chatCompletionsUrl', () => {
  it('chatCompletionsUrl_conV1_soloAnadeChatCompletions', () => {
    expect(chatCompletionsUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('chatCompletionsUrl_sinRuta_asumeV1', () => {
    expect(chatCompletionsUrl('http://192.168.1.5:1234')).toBe('http://192.168.1.5:1234/v1/chat/completions');
  });

  it('chatCompletionsUrl_conBarraFinal_noDuplicaSeparador', () => {
    expect(chatCompletionsUrl('http://localhost:11434/v1//')).toBe('http://localhost:11434/v1/chat/completions');
    expect(chatCompletionsUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('chatCompletionsUrl_rutaExplicitaSinV1_seRespeta', () => {
    expect(chatCompletionsUrl('https://host/api/openai')).toBe('https://host/api/openai/chat/completions');
  });

  it('chatCompletionsUrl_urlCompletaHastaChatCompletions_seDejaIgual', () => {
    expect(chatCompletionsUrl('https://host/v1/chat/completions')).toBe('https://host/v1/chat/completions');
  });

  it('chatCompletionsUrl_conQueryOFragmento_losDescarta', () => {
    expect(chatCompletionsUrl('http://localhost:11434/v1?beta=1#x')).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('chatCompletionsUrl_vacia_lanza', () => {
    expect(() => chatCompletionsUrl('   ')).toThrow(/vacia/);
  });

  it('chatCompletionsUrl_protocoloNoHttp_lanzaConElValor', () => {
    expect(() => chatCompletionsUrl('ftp://host/v1')).toThrow(/"ftp:\/\/host\/v1"/);
  });
});
