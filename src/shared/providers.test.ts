import { describe, expect, it } from 'vitest';
import { AGY_PROVIDER_ID, BUILT_IN_PROVIDERS, chatCompletionsUrl, CODEX_PROVIDER_ID } from './providers';
import { renderForLog, UserFacingError } from './i18n/localizedText';
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

describe('BUILT_IN_PROVIDERS labels', () => {
  it('builtInProviders_agy_labelEsLaClaveDeLaEtiqueta', () => {
    const agy = BUILT_IN_PROVIDERS.find((provider) => provider.id === AGY_PROVIDER_ID);

    expect(agy?.label).toEqual({ key: 'prompt.providers.agyLabel' });
    expect(agy === undefined ? '' : renderForLog(agy.label)).toBe('Antigravity · el CLI de Google (agy) · sin permisos');
  });
});

describe('chatCompletionsUrl', () => {
  it('chatCompletionsUrl_urlVacia_lanzaUserFacingErrorConLaClave', () => {
    expect(() => chatCompletionsUrl('  ')).toThrow(UserFacingError);
    expect(() => chatCompletionsUrl('  ')).toThrow(/URL base del proveedor esta vacia/);
  });

  it('chatCompletionsUrl_protocoloFtp_lanzaConClaveYValorRecibido', () => {
    const thrown = (() => {
      try {
        return chatCompletionsUrl('ftp://host');
      } catch (err) {
        return err;
      }
    })();

    expect((thrown as UserFacingError).localized).toEqual({ key: 'settings.providers.baseUrlNotHttp', values: { value: '"ftp://host"' } });
  });
});
