import { describe, expect, it } from 'vitest';
import { modelsUrl } from '@shared/providers';
import { parseAgyModelsOutput, parseOpenAiModels, probeProvider, type ProbeDeps } from './providerProbe';

// Deps de sondeo con todo apagado; cada test enciende SOLO lo que mide.
function deps(overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    findClaudeBinary: () => null,
    findAgyBinary: () => null,
    findCodexBinary: () => null,
    runCli: () => Promise.reject(new Error('runCli no esperado')),
    fetchJson: () => Promise.reject(new Error('fetchJson no esperado')),
    env: {},
    loadClaudeModels: () => [],
    ...overrides,
  };
}

describe('parseAgyModelsOutput', () => {
  // Salida REAL medida el 2026-09-18 con `agy models` (1.1.x) contra la cuenta del usuario.
  const REAL_OUTPUT = [
    'Fetching available models...',
    'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
    'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
    '',
  ].join('\n');

  it('parseAgyModelsOutput_salidaReal_devuelveIdYEtiquetaSinLaCabecera', () => {
    const models = parseAgyModelsOutput(REAL_OUTPUT);

    expect(models).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    ]);
  });

  it('parseAgyModelsOutput_lineaSinEtiqueta_usaElIdComoEtiqueta', () => {
    expect(parseAgyModelsOutput('solo-id\t   ')).toEqual([{ id: 'solo-id', label: 'solo-id' }]);
  });

  it('parseAgyModelsOutput_salidaVacia_devuelveListaVacia', () => {
    expect(parseAgyModelsOutput('')).toEqual([]);
  });
});

describe('parseOpenAiModels', () => {
  it('parseOpenAiModels_respuestaOpenAi_devuelveUnModeloPorId', () => {
    const body = { object: 'list', data: [{ id: 'llama3' }, { id: 'mistral' }] };

    expect(parseOpenAiModels(body)).toEqual([
      { id: 'llama3', label: 'llama3' },
      { id: 'mistral', label: 'mistral' },
    ]);
  });

  it('parseOpenAiModels_sinCampoData_lanzaConLoRecibido', () => {
    expect(() => parseOpenAiModels({ modelos: [] })).toThrow(/\{"modelos":\[\]\}/);
  });

  it('parseOpenAiModels_dataVacia_devuelveListaVacia', () => {
    expect(parseOpenAiModels({ data: [] })).toEqual([]);
  });
});

describe('probeProvider', () => {
  it('probeProvider_idVacio_lanzaConElValorRecibido', async () => {
    await expect(probeProvider({ providerId: '  ', baseUrl: null, apiKey: null }, deps())).rejects.toThrow(/"  "/);
  });

  it('probeProvider_claudeConCatalogoSondeado_devuelveSusModelos', async () => {
    // P-026 2.4: el catalogo sale del `initialize` del CLI, que main cachea por cuenta.
    const models = [{ id: 'opus', label: 'Opus 5.5' }];
    const result = await probeProvider(
      { providerId: 'claude', baseUrl: null, apiKey: null },
      deps({ findClaudeBinary: () => '/home/u/.local/bin/claude', loadClaudeModels: () => models }),
    );

    expect(result).toEqual({ kind: 'cli', endpoint: '/home/u/.local/bin/claude', models, error: null });
  });

  it('probeProvider_claudeInstalado_devuelveLaRutaYLaListaCurada', async () => {
    const result = await probeProvider(
      { providerId: 'claude', baseUrl: null, apiKey: null },
      deps({ findClaudeBinary: () => '/home/u/.local/bin/claude' }),
    );

    expect(result.kind).toBe('cli');
    expect(result.endpoint).toBe('/home/u/.local/bin/claude');
    expect(result.models).toBeNull();
    expect(result.error).toMatch(/Todavía no se ha sondeado/);
  });

  it('probeProvider_agyInstalado_listaLosModelosQueDiceElCli', async () => {
    const result = await probeProvider(
      { providerId: 'agy', baseUrl: null, apiKey: null },
      deps({
        findAgyBinary: () => 'C:/agy.exe',
        runCli: (bin, args) =>
          bin === 'C:/agy.exe' && args[0] === 'models'
            ? Promise.resolve('Fetching available models...\nm1\tModelo 1\n')
            : Promise.reject(new Error(`llamada inesperada: ${bin} ${args.join(' ')}`)),
      }),
    );

    expect(result.models).toEqual([{ id: 'm1', label: 'Modelo 1' }]);
    expect(result.error).toBeNull();
  });

  it('probeProvider_agyNoInstalado_noLanzaYExplicaComoInstalarlo', async () => {
    const result = await probeProvider({ providerId: 'agy', baseUrl: null, apiKey: null }, deps());

    expect(result.endpoint).toBeNull();
    expect(result.models).toBeNull();
    expect(result.error).toMatch(/agy install/);
  });

  it('probeProvider_agyFallaElCli_devuelveElMotivoEnVezDeInventarLista', async () => {
    const result = await probeProvider(
      { providerId: 'agy', baseUrl: null, apiKey: null },
      deps({ findAgyBinary: () => 'agy', runCli: () => Promise.reject(new Error('sin login')) }),
    );

    expect(result.models).toBeNull();
    expect(result.error).toBe('No se pudo listar: sin login');
  });

  it('probeProvider_proveedorDelUsuario_consultaSuEndpointDeModelos', async () => {
    const seen: string[] = [];
    const result = await probeProvider(
      { providerId: 'custom:ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' },
      deps({
        fetchJson: (url) => {
          seen.push(url);
          return Promise.resolve({ data: [{ id: 'llama3' }] });
        },
      }),
    );

    expect(seen).toEqual(['http://localhost:11434/v1/models']);
    expect(result.kind).toBe('http');
    expect(result.models).toEqual([{ id: 'llama3', label: 'llama3' }]);
  });

  it('probeProvider_builtInSinVariableDeEntorno_diceQueFaltaLaKey', async () => {
    const result = await probeProvider({ providerId: 'openai', baseUrl: null, apiKey: null }, deps());

    expect(result.models).toBeNull();
    expect(result.error).toMatch(/OPENAI_API_KEY/);
  });

  it('probeProvider_builtInConKeyEnElEntorno_laUsaSinQueViajePorIpc', async () => {
    let usedKey = '';
    const result = await probeProvider(
      { providerId: 'openai', baseUrl: null, apiKey: null },
      deps({
        env: { OPENAI_API_KEY: 'sk-real' },
        fetchJson: (_url, apiKey) => {
          usedKey = apiKey;
          return Promise.resolve({ data: [{ id: 'gpt-4o' }] });
        },
      }),
    );

    expect(usedKey).toBe('sk-real');
    expect(result.models).toEqual([{ id: 'gpt-4o', label: 'gpt-4o' }]);
  });

  it('probeProvider_endpointCaido_devuelveElMotivoYLaUrlSondeada', async () => {
    const result = await probeProvider(
      { providerId: 'custom:ollama', baseUrl: 'http://localhost:11434/v1', apiKey: null },
      deps({ fetchJson: () => Promise.reject(new Error('fetch failed')) }),
    );

    expect(result.endpoint).toBe('http://localhost:11434/v1');
    expect(result.error).toBe('No se pudo listar: fetch failed');
  });
});

describe('modelsUrl', () => {
  it('modelsUrl_conV1_cuelgaModelsDeLaMismaRaiz', () => {
    expect(modelsUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/models');
  });

  it('modelsUrl_sinRuta_asumeV1', () => {
    expect(modelsUrl('http://192.168.1.5:1234')).toBe('http://192.168.1.5:1234/v1/models');
  });

  it('modelsUrl_urlPegadaHastaChatCompletions_recortaYUsaLaRaiz', () => {
    expect(modelsUrl('https://host/v1/chat/completions')).toBe('https://host/v1/models');
  });

  it('modelsUrl_rutaExplicitaDeGemini_seRespeta', () => {
    expect(modelsUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
    );
  });
});

// Codex (CLI de OpenAI). Detectado el 2026-09-18 en la maquina del usuario con codex-cli 0.144.4.
describe('probeProvider — codex', () => {
  it('codexInstalado_devuelveSuRutaYElMotivoDeQueAunNoSePuedaUsar', async () => {
    const bin = 'C:\Users\quien\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe';

    const result = await probeProvider({ providerId: 'codex', baseUrl: null, apiKey: '' }, deps({ findCodexBinary: () => bin }));

    expect(result.kind).toBe('cli');
    expect(result.endpoint).toBe(bin);
    // No hay catalogo preguntable: igual que Claude, no hay ningun comando que liste modelos.
    expect(result.models).toBeNull();
    // El motivo NO es un fallo: es "detectado, pero falta el adapter". La UI lo distingue por el
    // endpoint, que no es null.
    expect(result.error).toContain('adapter');
  });

  it('codexNoInstalado_endpointNuloParaQueAjustesNoLoListe', async () => {
    const result = await probeProvider({ providerId: 'codex', baseUrl: null, apiKey: '' }, deps());

    // `endpoint === null` es la senal UNICA con la que Proveedores decide no mostrar un proveedor.
    expect(result.endpoint).toBeNull();
    expect(result.error).toContain('MAGE_CODEX_BIN');
  });
});
