import type { ProviderModel } from '@shared/providers';
import { describe, expect, it } from 'vitest';
import { permissionRank, resolveDelegatedSettings } from './delegatedSettings';
import type { SessionSettings } from './delegatedSettings';
import { MagePolicyError } from './errors';

const claude = (permissionMode?: string, model = 'sonnet', effort = 'high'): SessionSettings => ({
  provider: 'claude', model, effort, ...(permissionMode === undefined ? {} : { permissionMode }),
});
const codex = (permissionMode: string): SessionSettings => ({ provider: 'codex', model: 'gpt-x', permissionMode });
const ask = (
  creator: SessionSettings | null,
  targetProvider: 'claude' | 'codex',
  requested: { model?: string; effort?: string; permissionMode?: string } = {},
  catalog: readonly ProviderModel[] = [],
) => resolveDelegatedSettings({ creator, targetProvider, requested, catalog });

const GPT_X: ProviderModel = { id: 'gpt-x', label: 'GPT X', supportedEfforts: ['low', 'high'] };

describe('resolveDelegatedSettings', () => {
  it('resolveDelegatedSettings_sinParametrosMismoProveedor_heredaModeloEsfuerzoYModo', () => {
    expect(ask(claude('plan'), 'claude')).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'plan' });
  });

  it('resolveDelegatedSettings_creadoraEnOmitirPermisos_heredaOmitirPermisos', () => {
    expect(ask(claude('bypassPermissions'), 'claude').permissionMode).toBe('bypassPermissions');
  });

  it.each([
    ['acceptEdits', 'plan'],
    ['default', 'default'],
    ['bypassPermissions', 'auto'],
  ])('resolveDelegatedSettings_modoPedidoIgualOMasRestrictivo_loUsa (%s, pedido %s)', (creatorMode, requestedMode) => {
    expect(ask(claude(creatorMode), 'claude', { permissionMode: requestedMode }).permissionMode).toBe(requestedMode);
  });

  it('resolveDelegatedSettings_modoPedidoMasPermisivo_rechazaConMotivo', () => {
    const act = () => ask(claude('default'), 'claude', { permissionMode: 'bypassPermissions' });
    expect(act).toThrow(MagePolicyError);
    expect(act).toThrow('permission_mode_exceeds_creator: bypassPermissions (creadora: default)');
  });

  it('resolveDelegatedSettings_modoQueNoExisteEnElDestino_rechaza', () => {
    expect(() => ask(claude('bypassPermissions'), 'claude', { permissionMode: 'dontAsk' })).toThrow('invalid_permission_mode: dontAsk (claude)');
    expect(() => ask(claude('bypassPermissions'), 'codex', { permissionMode: 'plan' })).toThrow('invalid_permission_mode: plan (codex)');
  });

  it('resolveDelegatedSettings_creadoraSinModoConocido_cuentaComoManual', () => {
    expect(ask(claude(undefined), 'claude').permissionMode).toBe('default');
    expect(() => ask(claude(undefined), 'claude', { permissionMode: 'acceptEdits' })).toThrow('permission_mode_exceeds_creator: acceptEdits (creadora: desconocido)');
  });

  it('resolveDelegatedSettings_sinCreadora_nadaHeredadoYManual', () => {
    const result = ask(null, 'codex');

    expect(result).toEqual({ permissionMode: ':read-only' });
    expect(result).not.toHaveProperty('model');
    expect(result).not.toHaveProperty('effort');
  });

  it('resolveDelegatedSettings_otroProveedorSinParametros_modeloYEsfuerzoDelDestino', () => {
    expect(ask(claude('plan'), 'codex')).toEqual({ permissionMode: ':read-only|never' });
  });

  it.each([
    ['plan', ':read-only|never'],
    ['default', ':read-only'],
    ['acceptEdits', ':workspace'],
    ['auto', ':workspace|never'],
    ['bypassPermissions', ':danger-full-access|never'],
  ])('resolveDelegatedSettings_traduccionDeClaudeACodex (%s)', (from, to) => {
    expect(ask(claude(from), 'codex').permissionMode).toBe(to);
  });

  it.each([
    [':read-only|never', 'plan'],
    [':read-only', 'default'],
    [':workspace', 'acceptEdits'],
    [':workspace|never', 'auto'],
    [':danger-full-access', 'bypassPermissions'],
    [':danger-full-access|never', 'bypassPermissions'],
    [':custom', 'default'],
  ])('resolveDelegatedSettings_traduccionDeCodexAClaude (%s)', (from, to) => {
    expect(ask(codex(from), 'claude').permissionMode).toBe(to);
  });

  it('resolveDelegatedSettings_codexPedidoEnFormaLarga_seNormaliza', () => {
    expect(ask(claude('acceptEdits'), 'codex', { permissionMode: ':workspace|on-request' }).permissionMode).toBe(':workspace');
  });

  it('resolveDelegatedSettings_codexSinSandboxDesdeAuto_rechaza', () => {
    expect(() => ask(claude('auto'), 'codex', { permissionMode: ':danger-full-access' })).toThrow('permission_mode_exceeds_creator');
  });

  it('resolveDelegatedSettings_perfilDesconocidoPedido_soloDesdeOmitirPermisos', () => {
    expect(() => ask(claude('auto'), 'codex', { permissionMode: ':custom' })).toThrow('permission_mode_exceeds_creator');
    expect(ask(claude('bypassPermissions'), 'codex', { permissionMode: ':custom' }).permissionMode).toBe(':custom');
  });

  it('resolveDelegatedSettings_mismoCodexConPerfilDesconocido_loHereda', () => {
    expect(ask(codex(':custom'), 'codex').permissionMode).toBe(':custom');
  });

  it('resolveDelegatedSettings_modeloPedidoEnElCatalogo_loUsa', () => {
    const result = ask(claude('plan'), 'codex', { model: 'gpt-x', effort: 'high' }, [GPT_X]);

    expect(result).toEqual({ model: 'gpt-x', effort: 'high', permissionMode: ':read-only|never' });
  });

  it('resolveDelegatedSettings_modeloFueraDelCatalogo_rechazaConLosValidos', () => {
    const catalog = [{ id: 'gpt-x', label: 'X' }, { id: 'gpt-y', label: 'Y' }];

    expect(() => ask(claude('plan'), 'codex', { model: 'nope' }, catalog)).toThrow('invalid_model: nope (válidos: gpt-x, gpt-y)');
  });

  it('resolveDelegatedSettings_catalogoVacio_noValidaElModelo', () => {
    expect(ask(claude('plan'), 'codex', { model: 'cualquiera' }, []).model).toBe('cualquiera');
  });

  it('resolveDelegatedSettings_esfuerzoNoSoportadoPorElModelo_rechaza', () => {
    expect(() => ask(claude('plan'), 'codex', { model: 'gpt-x', effort: 'max' }, [GPT_X])).toThrow('invalid_effort: max (válidos para gpt-x: low, high)');
  });

  it('resolveDelegatedSettings_esfuerzoHeredadoNoSeValida', () => {
    const catalog = [{ id: 'sonnet', label: 'S', supportedEfforts: ['low'] }];

    expect(ask(claude('plan', 'sonnet', 'max'), 'claude', {}, catalog).effort).toBe('max');
  });
});

describe('permissionRank', () => {
  it('permissionRank_proveedorSinMcp_null', () => {
    expect(permissionRank('agy', 'plan')).toBeNull();
  });
});
