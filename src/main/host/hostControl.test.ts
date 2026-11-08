import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AccountCreateParams, AccountInfo } from '@shared/accounts';
import type { ChatProject } from '@shared/settings';
import { createHostControl, MAX_CREATE_RECEIPTS, resolveHostLaunchParams, type HostControlDeps } from './hostControl';
import { BypassPermissionsBlockedError, TrustRequiredError, UnknownAccountError } from './hostErrors';
import type { HostCreateRequest } from './hostProtocol';

const CWD = resolve('proyecto');
const COMMAND_ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const CLAUDE: AccountInfo = { configDir: '/h/.claude', name: '.claude', providerId: 'claude', authKind: 'subscription', defaultModel: 'sonnet', email: 'x@y.z', org: 'Org', isMain: true, loginStatus: 'logged_in', expiresAt: null };
const CODEX: AccountInfo = { ...CLAUDE, configDir: '/h/.codex', name: '.codex', providerId: 'codex', authKind: 'api-key', defaultModel: null, isMain: false };

function harness(overrides: Partial<HostControlDeps> = {}) {
  const deps = {
    listAccounts: vi.fn(() => [CLAUDE, CODEX]),
    listProjects: vi.fn((): readonly ChatProject[] => []),
    defaultModels: vi.fn((): Readonly<Record<string, string>> => ({})),
    isTrusted: vi.fn(() => true),
    launch: vi.fn(() => 's-1'),
    conversationIdOf: vi.fn(() => null),
    options: { setModel: vi.fn(), setEffort: vi.fn(), setPermissionMode: vi.fn() },
    createAccount: vi.fn((params: AccountCreateParams): AccountInfo => ({ ...CODEX, configDir: '/h/codex-nueva', name: params.name, providerId: params.providerId, authKind: 'api-key' })),
    requestQuit: vi.fn(),
    ...overrides,
  };
  return { deps, control: createHostControl(deps) };
}

function request(overrides: Partial<HostCreateRequest> = {}): HostCreateRequest {
  return { commandId: COMMAND_ID, provider: 'claude', accountId: '/h/.claude', cwd: CWD, trust: { acknowledged: false }, ...overrides };
}

describe('HostControl.createSession', () => {
  it('createSession_cuentaYCarpetaBuenas_lanzaConLosParametrosResueltos', () => {
    const h = harness();

    const result = h.control.createSession(request());

    expect(h.deps.launch).toHaveBeenCalledTimes(1);
    expect(h.deps.launch).toHaveBeenCalledWith({ accountDir: '/h/.claude', provider: 'claude', cwd: CWD, model: 'sonnet' });
    expect(result).toEqual({ sessionId: 's-1', conversationId: null });
  });

  it('createSession_mismoCommandId_noLanzaDosVeces', () => {
    const h = harness();

    const first = h.control.createSession(request());
    const second = h.control.createSession(request());

    expect(h.deps.launch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('createSession_carpetaNoConfiable_trustRequiredSinLanzar', () => {
    const h = harness({ isTrusted: vi.fn(() => false) });

    expect(() => h.control.createSession(request({ trust: { acknowledged: true } }))).toThrow(TrustRequiredError);
    expect(h.deps.launch).not.toHaveBeenCalled();
  });

  it('createSession_cuentaDeOtroProveedor_unknownAccount', () => {
    const h = harness();

    expect(() => h.control.createSession(request({ accountId: '/h/.codex', provider: 'claude' }))).toThrow(UnknownAccountError);
    expect(h.deps.launch).not.toHaveBeenCalled();
  });

  it('createSession_cuentaInexistente_unknownAccount', () => {
    const h = harness();

    expect(() => h.control.createSession(request({ accountId: '/h/.nada' }))).toThrow(UnknownAccountError);
  });

  it('createSession_rutaRelativa_errorSinLanzar', () => {
    const h = harness();

    expect(() => h.control.createSession(request({ cwd: 'relativa' }))).toThrow('relativa');
    expect(h.deps.launch).not.toHaveBeenCalled();
  });

  it('createSession_permissionModeEnCodex_error', () => {
    const h = harness();

    expect(() => h.control.createSession(request({ provider: 'codex', accountId: '/h/.codex', model: 'gpt', permissionMode: 'plan' }))).toThrow('codex');
    expect(h.deps.launch).not.toHaveBeenCalled();
  });

  it('createSession_bypassPermissions_rechazaSinLanzarNiGuardarRecibo', () => {
    const h = harness();

    expect(() => h.control.createSession(request({ permissionMode: 'bypassPermissions' }))).toThrow(BypassPermissionsBlockedError);
    expect(h.deps.launch).not.toHaveBeenCalled();
    h.control.createSession(request({ permissionMode: 'default' }));
    expect(h.deps.launch).toHaveBeenCalledTimes(1);
  });

  it.each(['plan', 'acceptEdits', 'default', 'auto'] as const)('createSession_%s_siguenLanzando', (permissionMode) => {
    const h = harness();

    h.control.createSession(request({ permissionMode }));

    expect(h.deps.launch).toHaveBeenCalledWith(expect.objectContaining({ permissionMode }));
  });

  it('resolveHostLaunchParams_permissionModeEnCodex_loDejaPasar', () => {
    const h = harness();

    const params = resolveHostLaunchParams(h.deps, request({ provider: 'codex', accountId: '/h/.codex', model: 'gpt-x', permissionMode: 'plan' }));

    expect(params.permissionMode).toBe('plan');
  });

  it('createSession_sinModeloEnNingunSitio_error', () => {
    const h = harness();

    expect(() => h.control.createSession(request({ provider: 'codex', accountId: '/h/.codex' }))).toThrow('No hay modelo por defecto para codex');
  });

  it('resolveHostLaunchParams_sinModeloConCliDefault_lanzaSinModelo', () => {
    const h = harness();

    const params = resolveHostLaunchParams(h.deps, request({ provider: 'codex', accountId: '/h/.codex' }), { cliDefaultModel: true });

    expect(params.model).toBe('');
  });

  it('resolveHostLaunchParams_sinModeloSinOpcion_lanza', () => {
    const h = harness();

    expect(() => resolveHostLaunchParams(h.deps, request({ provider: 'codex', accountId: '/h/.codex' }))).toThrow('No hay modelo por defecto para codex');
  });

  it('createSession_modeloDeLosAjustes_ganaAlDeLaCuenta', () => {
    const h = harness({ defaultModels: vi.fn(() => ({ claude: 'opus' })) });

    h.control.createSession(request());

    expect(h.deps.launch).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
  });

  it('createSession_esfuerzoDeLosAjustes_seUsaSiNoSePide', () => {
    const h = harness({ defaultModels: vi.fn(() => ({ 'claude#effort': 'low' })) });

    h.control.createSession(request());

    expect(h.deps.launch).toHaveBeenCalledWith(expect.objectContaining({ effort: 'low' }));
  });

  it('createSession_esfuerzoVacioEnAjustes_noSeEnvia', () => {
    const h = harness({ defaultModels: vi.fn(() => ({ 'claude#effort': '' })) });

    h.control.createSession(request());

    expect(vi.mocked(h.deps.launch).mock.calls[0]![0]).not.toHaveProperty('effort');
  });

  it('createSession_masDeCienRecibos_olvidaElMasAntiguo', () => {
    const h = harness();
    const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    for (let n = 0; n <= MAX_CREATE_RECEIPTS; n += 1) h.control.createSession(request({ commandId: idOf(n) }));
    h.control.createSession(request({ commandId: idOf(0) }));

    expect(h.deps.launch).toHaveBeenCalledTimes(MAX_CREATE_RECEIPTS + 2);
  });
});

describe('HostControl — opciones y catálogos', () => {
  it.each([
    ['model', 'setModel', 'opus'],
    ['effort', 'setEffort', 'low'],
    ['permissionMode', 'setPermissionMode', 'plan'],
  ] as const)('setOption_%s_llamaASuSetter', (key, setter, value) => {
    const h = harness();

    h.control.setOption('s-1', key, value);

    expect(h.deps.options[setter]).toHaveBeenCalledWith('s-1', value);
  });

  it('setOption_permissionModeBypass_rechazaSinLlamarAlSetter', () => {
    const h = harness();

    expect(() => h.control.setOption('s-1', 'permissionMode', 'bypassPermissions')).toThrow(BypassPermissionsBlockedError);
    expect(h.deps.options.setPermissionMode).not.toHaveBeenCalled();
  });

  it('setOption_modelLlamadoBypassPermissions_noSeBloquea', () => {
    const h = harness();

    h.control.setOption('s-1', 'model', 'bypassPermissions');

    expect(h.deps.options.setModel).toHaveBeenCalledWith('s-1', 'bypassPermissions');
  });

  it('listAccounts_soloIdNombreProveedorYFacturacion', () => {
    const h = harness();

    const result = h.control.listAccounts();

    expect(Object.keys(result[0]!).sort()).toEqual(['billing', 'id', 'name', 'provider']);
    expect(JSON.stringify(result)).not.toContain('x@y.z');
    expect(JSON.stringify(result)).not.toContain('Org');
  });

  it('listProjects_soloIdNombreYCarpeta', () => {
    const project: ChatProject = { id: 'p1', name: 'P', instructions: 'secreto', cwd: '/x', sessionIds: ['a'] };
    const h = harness({ listProjects: vi.fn(() => [project]) });

    const result = h.control.listProjects();

    expect(result).toEqual([{ id: 'p1', name: 'P', cwd: '/x' }]);
  });

  it('createApiAccount_pasaClaveYTipoApiKeyYDevuelveLaProyeccion', () => {
    const h = harness();

    const result = h.control.createApiAccount({ provider: 'codex', name: 'Trabajo', apiKey: 'sk-SECRETA-123' });

    expect(h.deps.createAccount).toHaveBeenCalledWith({ providerId: 'codex', authKind: 'api-key', name: 'Trabajo', apiKey: 'sk-SECRETA-123' });
    expect(result).toEqual({ id: '/h/codex-nueva', name: 'Trabajo', provider: 'codex', billing: 'api-key' });
    expect(JSON.stringify(result)).not.toContain('sk-SECRETA-123');
  });

  it('createApiAccount_laCreacionFalla_propagaElError', () => {
    const h = harness({ createAccount: vi.fn(() => { throw new Error('bóveda no disponible'); }) });

    expect(() => h.control.createApiAccount({ provider: 'claude', name: 'K', apiKey: 'sk-x' })).toThrow('bóveda no disponible');
  });

  it('requestQuit_delegaEnLaDependencia', () => {
    const h = harness();

    h.control.requestQuit();

    expect(h.deps.requestQuit).toHaveBeenCalledTimes(1);
  });
});
