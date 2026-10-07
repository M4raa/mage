import { describe, expect, it } from 'vitest';
import type { CustomProvider } from '@shared/providers';
import {
  AGY_PROVIDER_ID,
  BUILT_IN_PROVIDERS,
  CODEX_PROVIDER_ID,
  CUSTOM_PROVIDER_ID_PREFIX,
  isAutoApprovedProvider,
  writesClaudeTranscript,
} from '@shared/providers';
import {
  EMPTY_CUSTOM_PROVIDER_DRAFT,
  claudeModelOptions,
  displayModelId,
  modelOptionsForProvider,
  modelsToDraftText,
  nextCustomProviderId,
  parseModelIds,
  providerFallbackModel,
  providerModels,
  providerOptions,
  validateCustomProviderDraft,
  applyRuntimeProbe,
  draftFromProvider,
  type CustomProviderDraft,
} from './models';

const CLAUDE_MODELS = BUILT_IN_PROVIDERS.find((provider) => provider.id === 'claude')?.models ?? [];

function customProvider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: 'custom:ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    hasApiKey: false,
    models: [{ id: 'llama3', label: 'llama3' }],
    ...overrides,
  };
}

function draft(overrides: Partial<CustomProviderDraft> = {}): CustomProviderDraft {
  return { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', forgetApiKey: false, models: 'llama3, mistral', contextWindow: '', supportsTools: 'auto', ...overrides };
}

describe('modelOptionsForProvider', () => {
  it('modelOptionsForProvider_proveedorConocido_devuelveSusModelos', () => {
    const ids = modelOptionsForProvider('codex', 'gpt-6.1-sol').map((m) => m.id);

    expect(ids.slice(0, 2)).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);
  });

  it('modelOptionsForProvider_codexConCatalogoVivo_usaModelListYEsfuerzos', () => {
    const live = [{ id: 'gpt-vivo', label: 'GPT Vivo', supportedEfforts: ['low', 'ultra'] }];

    expect(modelOptionsForProvider('codex', 'gpt-vivo', [], live)).toEqual(live);
  });

  it('modelOptionsForProvider_proveedorDesconocido_caeAClaude', () => {
    expect(modelOptionsForProvider('inventado', 'sonnet')).toEqual(CLAUDE_MODELS);
  });

  it('modelOptionsForProvider_modeloFueraDeLaLista_loAnadeAlPrincipio', () => {
    // Un modelo persistido de otra version no puede desaparecer del selector: se leeria como si Mage
    // hubiera cambiado el modelo por su cuenta.
    const options = modelOptionsForProvider('claude', 'claude-sonnet-4-5');

    expect(options[0]).toEqual({ id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' });
    expect(options).toHaveLength(CLAUDE_MODELS.length + 1);
  });

  it('modelOptionsForProvider_modeloYaEnLaLista_noSeDuplica', () => {
    const ids = modelOptionsForProvider('claude', 'opus').map((m) => m.id);

    expect(ids.filter((id) => id === 'opus')).toHaveLength(1);
  });

  it('modelOptionsForProvider_modeloVacio_devuelveLaListaSinAnadirNada', () => {
    expect(modelOptionsForProvider('claude', '')).toEqual(CLAUDE_MODELS);
  });

  it('modelOptionsForProvider_opus1mGuardado_noDuplicaSuBase', () => {
    // Un `opus[1m]` guardado de antes se enseña como `opus` (displayModelId): no se añade otra opcion.
    expect(modelOptionsForProvider('claude', 'opus[1m]').map((m) => m.id)).not.toContain('opus[1m]');
  });

  it('modelOptionsForProvider_proveedorDelUsuario_devuelveSusModelos', () => {
    const ids = modelOptionsForProvider('custom:ollama', 'llama3', [customProvider()]).map((m) => m.id);

    expect(ids).toEqual(['llama3']);
  });

  it('modelOptionsForProvider_proveedorDelUsuarioSinModelos_caeAClaude', () => {
    expect(modelOptionsForProvider('custom:ollama', 'sonnet', [customProvider({ models: [] })])).toEqual(CLAUDE_MODELS);
  });
});

describe('providerOptions', () => {
  // Desde la 0.1.2 todos los de serie tienen adapter (Codex sobre `codex app-server`, sin verificar).
  it('providerOptions_sinProveedoresDelUsuario_devuelveLosDeSerie', () => {
    expect(providerOptions([]).map((p) => p.id)).toEqual(BUILT_IN_PROVIDERS.map((p) => p.id));
  });

  it('providerOptions_codex_seOfrece', () => {
    expect(providerOptions([]).map((p) => p.id)).toContain(CODEX_PROVIDER_ID);
  });

  it('providerOptions_conProveedorDelUsuario_loAnadeAlFinal', () => {
    const ids = providerOptions([customProvider()]).map((p) => p.id);

    expect(ids[ids.length - 1]).toBe('custom:ollama');
    expect(ids).toHaveLength(BUILT_IN_PROVIDERS.length + 1);
  });

  it('providerOptions_proveedorSinModelos_noSeOfrece', () => {
    // Ofrecerlo dejaria el selector de modelo vacio y no se podria abrir la conversacion.
    expect(providerOptions([customProvider({ models: [] })]).map((p) => p.id)).not.toContain('custom:ollama');
  });

  it('providerOptions_idQueColisionaConUnoDeSerie_seDescarta', () => {
    const options = providerOptions([customProvider({ id: 'codex', label: 'Impostor' })]);

    expect(options.filter((p) => p.id === 'codex')).toHaveLength(1);
    expect(options.find((p) => p.id === 'codex')?.label).not.toBe('Impostor');
  });

  it('providerOptions_dosProveedoresConElMismoId_soloElPrimero', () => {
    const options = providerOptions([customProvider({ label: 'Uno' }), customProvider({ label: 'Dos' })]);

    expect(options.filter((p) => p.id === 'custom:ollama')).toHaveLength(1);
    expect(options.find((p) => p.id === 'custom:ollama')?.label).toBe('Uno');
  });
});

describe('providerModels y providerFallbackModel', () => {
  it('providerFallbackModel_proveedorDeSerie_devuelveSuPrimerModelo', () => {
    expect(providerFallbackModel('codex', [])).toBe('gpt-6.1-sol');
  });

  it('providerFallbackModel_proveedorDelUsuario_devuelveSuPrimerModelo', () => {
    expect(providerFallbackModel('custom:ollama', [customProvider()])).toBe('llama3');
  });

  it('providerFallbackModel_proveedorDesconocido_devuelveNull', () => {
    expect(providerFallbackModel('inventado', [])).toBeNull();
  });

  it('providerModels_proveedorDelUsuarioSinModelos_devuelveNull', () => {
    expect(providerModels('custom:ollama', [customProvider({ models: [] })])).toBeNull();
  });
});

describe('parseModelIds', () => {
  it('parseModelIds_comasYSaltosDeLinea_devuelveLosIdsLimpios', () => {
    expect(parseModelIds(' llama3 ,mistral\nqwen2.5-coder ')).toEqual(['llama3', 'mistral', 'qwen2.5-coder']);
  });

  it('parseModelIds_duplicados_losColapsa', () => {
    expect(parseModelIds('llama3, llama3')).toEqual(['llama3']);
  });

  it('parseModelIds_textoVacioOSoloSeparadores_devuelveVacio', () => {
    expect(parseModelIds('')).toEqual([]);
    expect(parseModelIds(' , ,\n')).toEqual([]);
  });
});

describe('nextCustomProviderId', () => {
  it('nextCustomProviderId_etiquetaNormal_devuelveSlugConPrefijo', () => {
    expect(nextCustomProviderId('LM Studio', [])).toBe(`${CUSTOM_PROVIDER_ID_PREFIX}lm-studio`);
  });

  it('nextCustomProviderId_idYaCogido_anadeSufijoNumerico', () => {
    const taken = [`${CUSTOM_PROVIDER_ID_PREFIX}ollama`, `${CUSTOM_PROVIDER_ID_PREFIX}ollama-2`];

    expect(nextCustomProviderId('Ollama', taken)).toBe(`${CUSTOM_PROVIDER_ID_PREFIX}ollama-3`);
  });

  it('nextCustomProviderId_etiquetaSinCaracteresUtiles_usaUnNombreGenerico', () => {
    expect(nextCustomProviderId('###', [])).toBe(`${CUSTOM_PROVIDER_ID_PREFIX}proveedor`);
  });

  it('nextCustomProviderId_siempreLlevaPrefijo_nuncaColisionaConUnoDeSerie', () => {
    for (const builtIn of BUILT_IN_PROVIDERS) {
      expect(nextCustomProviderId(builtIn.label, [])).not.toBe(builtIn.id);
    }
  });
});

describe('validateCustomProviderDraft', () => {
  it('validateCustomProviderDraft_completo_devuelveElProveedor', () => {
    const result = validateCustomProviderDraft(draft({ apiKey: '  k  ' }), [], null);

    expect(result).toEqual({
      ok: true,
      provider: {
        id: `${CUSTOM_PROVIDER_ID_PREFIX}ollama`,
        label: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        hasApiKey: true,
        models: [
          { id: 'llama3', label: 'llama3' },
          { id: 'mistral', label: 'mistral' },
        ],
      },
      apiKeyUpdate: { kind: 'set', value: 'k' },
    });
  });

  it('validateCustomProviderDraft_editandoSinTeclearClave_conservaLaGuardada', () => {
    // La clave guardada nunca vuelve al renderer: un campo vacio al editar significa «no tocarla».
    const result = validateCustomProviderDraft(draft(), [customProvider({ hasApiKey: true })], 'custom:ollama');

    expect(result.ok && result.apiKeyUpdate).toEqual({ kind: 'keep' });
    expect(result.ok && result.provider.hasApiKey).toBe(true);
  });

  it('validateCustomProviderDraft_quitarClave_pideBorrarlaYQuedaSinClave', () => {
    const result = validateCustomProviderDraft(draft({ forgetApiKey: true }), [customProvider({ hasApiKey: true })], 'custom:ollama');

    expect(result.ok && result.apiKeyUpdate).toEqual({ kind: 'delete' });
    expect(result.ok && result.provider.hasApiKey).toBe(false);
  });

  it('validateCustomProviderDraft_quitarYTeclearOtra_ganaLaTecleada', () => {
    const result = validateCustomProviderDraft(draft({ forgetApiKey: true, apiKey: 'nueva' }), [customProvider({ hasApiKey: true })], 'custom:ollama');

    expect(result.ok && result.apiKeyUpdate).toEqual({ kind: 'set', value: 'nueva' });
  });

  it('validateCustomProviderDraft_altaSinClave_noTieneClave', () => {
    const result = validateCustomProviderDraft(draft(), [], null);

    expect(result.ok && result.apiKeyUpdate).toEqual({ kind: 'keep' });
    expect(result.ok && result.provider.hasApiKey).toBe(false);
  });

  it('validateCustomProviderDraft_sinNombre_rechazaConElMotivo', () => {
    const result = validateCustomProviderDraft(draft({ label: '   ' }), [], null);

    expect(result).toEqual({ ok: false, message: expect.stringContaining('nombre') });
  });

  it('validateCustomProviderDraft_urlVacia_rechaza', () => {
    expect(validateCustomProviderDraft(draft({ baseUrl: '' }), [], null).ok).toBe(false);
  });

  it('validateCustomProviderDraft_urlNoParseable_rechazaConElValorRecibido', () => {
    const result = validateCustomProviderDraft(draft({ baseUrl: 'localhost:11434' }), [], null);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('localhost:11434');
  });

  it('validateCustomProviderDraft_sinModelos_rechaza', () => {
    const result = validateCustomProviderDraft(draft({ models: '  ,  ' }), [], null);

    expect(result).toEqual({ ok: false, message: expect.stringContaining('al menos un modelo') });
  });

  it('validateCustomProviderDraft_formularioVacio_rechaza', () => {
    expect(validateCustomProviderDraft(EMPTY_CUSTOM_PROVIDER_DRAFT, [], null).ok).toBe(false);
  });

  it('validateCustomProviderDraft_nombreQueYaExiste_generaUnIdDistinto', () => {
    const result = validateCustomProviderDraft(draft(), [customProvider()], null);

    expect(result.ok ? result.provider.id : '').toBe(`${CUSTOM_PROVIDER_ID_PREFIX}ollama-2`);
  });

  it('validateCustomProviderDraft_editando_conservaSuId', () => {
    const result = validateCustomProviderDraft(draft({ label: 'Ollama renombrado' }), [customProvider()], 'custom:ollama');

    expect(result.ok ? result.provider.id : '').toBe('custom:ollama');
    expect(result.ok ? result.provider.label : '').toBe('Ollama renombrado');
  });
});

describe('modelsToDraftText', () => {
  it('modelsToDraftText_variosModelos_devuelveLosIdsSeparadosPorComas', () => {
    expect(modelsToDraftText([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])).toBe('a, b');
  });

  it('modelsToDraftText_sinModelos_devuelveTextoVacio', () => {
    expect(modelsToDraftText([])).toBe('');
  });
});

describe('catalogo de proveedores de serie', () => {
  it('cadaProveedorDeSerieTieneModelos', () => {
    for (const provider of BUILT_IN_PROVIDERS) {
      expect(provider.models.length, `sin modelos: ${provider.id}`).toBeGreaterThan(0);
    }
  });

  it('noHayIdsDeModeloDuplicadosDentroDeUnProveedor', () => {
    for (const provider of BUILT_IN_PROVIDERS) {
      const ids = provider.models.map((m) => m.id);
      expect(new Set(ids).size, `ids duplicados en ${provider.id}`).toBe(ids.length);
    }
  });

  it('noHayIdsDeProveedorDuplicados', () => {
    const ids = BUILT_IN_PROVIDERS.map((p) => p.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // P-032 R6: de serie solo quedan los tres CLI; `openai`/`gemini` se retiraron con el gateway.
  it('deSerie_soloLosTresCli', () => {
    expect(BUILT_IN_PROVIDERS.map((provider) => provider.id)).toEqual(['claude', AGY_PROVIDER_ID, CODEX_PROVIDER_ID]);
  });

  // El aviso de "sin permisos" que pinta la UI se apoya en esta lista: si `agy` desapareciera de ella,
  // sus pestanas dejarian de avisar de que auto-aprueban y esa es la peor regresion posible aqui.
  it('isAutoApprovedProvider_agy_true', () => {
    expect(isAutoApprovedProvider(AGY_PROVIDER_ID)).toBe(true);
    expect(isAutoApprovedProvider('claude')).toBe(false);
    expect(isAutoApprovedProvider('custom:ollama')).toBe(false);
  });

  // El runtime propio escribe la suya en el mismo formato (P-032 R4); agy y codex no. Si esto se
  // invirtiera, el Inspector pediria un fichero inexistente en cada pestana suya.
  it('writesClaudeTranscript_agyYCodexNo', () => {
    expect(writesClaudeTranscript(AGY_PROVIDER_ID)).toBe(false);
    expect(writesClaudeTranscript(CODEX_PROVIDER_ID)).toBe(false);
    expect(writesClaudeTranscript('claude')).toBe(true);
    expect(writesClaudeTranscript('custom:ollama')).toBe(true);
  });
});

// P-026 2.4 (D7): el catalogo que publica el CLI manda sobre la lista fija, que queda de reserva.
describe('modelOptionsForProvider — catalogo del CLI', () => {
  // Forma REAL (recortada) del catalogo de 2.1.283 ya normalizado.
  const CATALOG = [
    { id: 'default', label: 'Default (recommended)' },
    { id: 'opus', label: 'Opus 5.5' },
    { id: 'sonnet', label: 'Sonnet 5' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  ];

  it('modelOptionsForProvider_conCatalogo_usaElDelCliYNoLaReserva', () => {
    const ids = modelOptionsForProvider('claude', 'opus', [], CATALOG).map((m) => m.id);

    expect(ids).toContain('claude-opus-4-8');
    expect(ids).not.toContain('claude-fable-5-1'); // solo esta en la reserva
  });

  it('modelOptionsForProvider_conCatalogo_quitaDefaultYNoAnadeVariantes1M', () => {
    const options = modelOptionsForProvider('claude', 'sonnet', [], CATALOG);

    expect(options.map((m) => m.id)).toEqual(['opus', 'sonnet', 'claude-opus-4-8']);
  });

  it('modelOptionsForProvider_opus1mGuardadoConCatalogo_noAnadeOpcionExtra', () => {
    expect(modelOptionsForProvider('claude', 'opus[1m]', [], CATALOG).map((m) => m.id)).toEqual(['opus', 'sonnet', 'claude-opus-4-8']);
  });

  it('modelOptionsForProvider_sinCatalogo_caeALaReserva', () => {
    expect(modelOptionsForProvider('claude', 'opus', [], [])).toEqual(BUILT_IN_PROVIDERS.find((p) => p.id === 'claude')?.models);
  });

  it('modelOptionsForProvider_modeloActualFueraDelCatalogo_seConservaDelante', () => {
    const options = modelOptionsForProvider('claude', 'claude-haiku-x', [], CATALOG);

    expect(options[0]).toEqual({ id: 'claude-haiku-x', label: 'claude-haiku-x' });
  });

  it('modelOptionsForProvider_otroProveedor_ignoraElCatalogoDeClaude', () => {
    const ids = modelOptionsForProvider('agy', '', [], CATALOG).map((m) => m.id);

    expect(ids).not.toContain('claude-opus-4-8');
  });
});

describe('claudeModelOptions', () => {
  it('claudeModelOptions_catalogoConUnIdPropio1M_loRespeta', () => {
    // Medido: el catalogo del perfil privado trae `claude-fable-5[1m]` como un modelo mas.
    const catalog = [{ id: 'default', label: 'Default' }, { id: 'opus', label: 'Opus' }, { id: 'claude-fable-5[1m]', label: 'Fable' }];

    expect(claudeModelOptions(catalog).map((m) => m.id)).toEqual(['opus', 'claude-fable-5[1m]']);
  });
});

describe('displayModelId', () => {
  const OPTIONS = [
    { id: 'opus', label: 'Opus 5.5' },
    { id: 'claude-fable-5[1m]', label: 'Fable' },
  ];

  it('displayModelId_opus1mGuardadoConSuBaseEnLaLista_enseñaLaBase', () => {
    expect(displayModelId('opus[1m]', OPTIONS)).toBe('opus');
  });

  it('displayModelId_id1mQueEstaEnLaLista_seQuedaTalCual', () => {
    expect(displayModelId('claude-fable-5[1m]', OPTIONS)).toBe('claude-fable-5[1m]');
  });

  it('displayModelId_id1mSinBaseEnLaLista_seQuedaTalCual', () => {
    expect(displayModelId('sonnet[1m]', OPTIONS)).toBe('sonnet[1m]');
  });

  it('displayModelId_sinSufijo_talCual', () => {
    expect(displayModelId('haiku', OPTIONS)).toBe('haiku');
  });
});

// P-032 R7: ventana y herramientas en el formulario del proveedor, y lo que rellena «Probar conexión».
describe('borrador de proveedor del runtime', () => {
  it('validate_ventanaYHerramientas_pasanAlProveedor', () => {
    const result = validateCustomProviderDraft(draft({ contextWindow: ' 8192 ', supportsTools: 'no' }), [], null);

    expect(result.ok && result.provider).toMatchObject({ contextWindow: 8192, supportsTools: false });
  });

  it('validate_sinFijar_noLasDeclara', () => {
    const result = validateCustomProviderDraft(draft(), [], null);

    expect(result.ok && 'contextWindow' in result.provider).toBe(false);
    expect(result.ok && 'supportsTools' in result.provider).toBe(false);
  });

  it('validate_ventanaInvalida_loDice', () => {
    for (const value of ['abc', '512', '-4', '1.5']) {
      const result = validateCustomProviderDraft(draft({ contextWindow: value }), [], null);
      expect(result.ok, value).toBe(false);
    }
  });

  it('applyRuntimeProbe_rellenaLoQueSupoYConservaElResto', () => {
    const filled = applyRuntimeProbe(draft({ contextWindow: '4096' }), { models: ['a', 'b'], contextWindow: null, supportsTools: true, warning: null, error: null });

    expect(filled).toMatchObject({ models: 'a, b', contextWindow: '4096', supportsTools: 'yes' });
  });

  it('draftFromProvider_idaYVuelta_mismoProveedor', () => {
    const provider = customProvider({ contextWindow: 16000, supportsTools: true });

    const result = validateCustomProviderDraft(draftFromProvider(provider), [provider], provider.id);

    expect(result.ok && result.provider).toMatchObject({ contextWindow: 16000, supportsTools: true, models: provider.models });
  });
});
