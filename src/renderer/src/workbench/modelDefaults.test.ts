import { describe, expect, it } from 'vitest';
import { resolveDefaultModel } from './modelDefaults';

describe('resolveDefaultModel', () => {
  it('hayUltimoUsado_ganaSobreElConfigurado', () => {
    expect(resolveDefaultModel({ lastUsedModel: 'opus', accountDefaultModel: 'sonnet' })).toBe('opus');
  });

  it('sinUltimoUsado_usaElConfiguradoPorCuenta', () => {
    expect(resolveDefaultModel({ lastUsedModel: null, accountDefaultModel: 'haiku' })).toBe('haiku');
  });

  it('sinUltimoNiConfigurado_caeASonnet', () => {
    expect(resolveDefaultModel({ lastUsedModel: null, accountDefaultModel: null })).toBe('sonnet');
  });

  it('cadenasVacias_seTratanComoAusentes', () => {
    expect(resolveDefaultModel({ lastUsedModel: '  ', accountDefaultModel: '  ' })).toBe('sonnet');
  });

  it('configuradoPorProveedor_ganaSobreTodoLoDemas', () => {
    // F3: es una eleccion explicita del usuario PARA ese proveedor; si no ganara, configurar
    // "gemini-2.5-pro" no serviria de nada en cuanto se hubiera tocado otro modelo.
    expect(
      resolveDefaultModel({
        lastUsedModel: 'opus',
        accountDefaultModel: 'haiku',
        providerDefaultModel: 'gemini-2.5-pro',
        providerFallbackModel: 'gemini-2.5-flash',
      }),
    ).toBe('gemini-2.5-pro');
  });

  it('configuradoPorProveedorVacio_seIgnoraYSigueLaCadena', () => {
    expect(
      resolveDefaultModel({ lastUsedModel: 'opus', accountDefaultModel: null, providerDefaultModel: '  ' }),
    ).toBe('opus');
  });

  it('sinNadaConfigurado_usaElFallbackDelProveedor', () => {
    // Para un proveedor no-Claude, caer a 'sonnet' seria un modelo que ese proveedor no tiene.
    expect(
      resolveDefaultModel({
        lastUsedModel: null,
        accountDefaultModel: null,
        providerDefaultModel: null,
        providerFallbackModel: 'llama3',
      }),
    ).toBe('llama3');
  });

  it('sinFallbackDeProveedor_caeASonnet', () => {
    expect(
      resolveDefaultModel({ lastUsedModel: null, accountDefaultModel: null, providerFallbackModel: '  ' }),
    ).toBe('sonnet');
  });

  it('ordenCompletoDePrioridad', () => {
    const base = { lastUsedModel: 'ultimo', accountDefaultModel: 'cuenta', providerFallbackModel: 'fallback' };

    expect(resolveDefaultModel({ ...base, providerDefaultModel: 'proveedor' })).toBe('proveedor');
    expect(resolveDefaultModel({ ...base, providerDefaultModel: null })).toBe('ultimo');
    expect(resolveDefaultModel({ ...base, lastUsedModel: null })).toBe('cuenta');
    expect(resolveDefaultModel({ ...base, lastUsedModel: null, accountDefaultModel: null })).toBe('fallback');
  });
});
