import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROVIDERS, CODEX_PROVIDER_ID, supportsSteer } from './providers';
import measuredModels from './__fixtures__/codex-models-0160.json';

describe('Codex fallback catalog', () => {
  it('builtInProviders_codex0160_preservesMeasuredIdsLabelsAndEfforts', () => {
    // Preparar: contrato de model/list medido, independiente de la reserva.
    const codex = BUILT_IN_PROVIDERS.find((provider) => provider.id === CODEX_PROVIDER_ID);

    // Ejecutar.
    const models = codex?.models;

    // Comprobar: incluye los límites por modelo; Luna no admite ultra.
    expect(models).toEqual(measuredModels);
  });
});

describe('supportsSteer', () => {
  it('supportsSteer_claudeYCodex_true', () => {
    expect(supportsSteer('claude')).toBe(true);
    expect(supportsSteer(CODEX_PROVIDER_ID)).toBe(true);
  });

  it('supportsSteer_agyYRuntimePropio_false', () => {
    expect(supportsSteer('agy')).toBe(false);
    expect(supportsSteer('ollama-local')).toBe(false);
  });
});
