import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AccountInfo } from '@shared/accounts';
import { accountApiKeySecretId, ProviderAccountService, type ProviderAccountDeps } from './providerAccounts';

const HOME = join('/home', 'u');
const USER_DATA = join('/data', 'Mage');

function claudeAccount(configDir: string): AccountInfo {
  return {
    configDir,
    name: configDir.split(/[\\/]/).pop() ?? '',
    isMain: false,
    providerId: 'claude',
    authKind: 'subscription',
    email: null,
    org: null,
    loginStatus: 'logged_out',
    expiresAt: null,
    defaultModel: null,
  };
}

function setup(): { service: ProviderAccountService; files: Map<string, string>; secrets: Map<string, string>; deps: ProviderAccountDeps } {
  const files = new Map<string, string>();
  const secrets = new Map<string, string>();
  const deps: ProviderAccountDeps = {
    filePath: join(USER_DATA, 'provider-accounts.json'),
    homedir: HOME,
    userDataDir: USER_DATA,
    vault: {
      set: (id, value) => secrets.set(id, value),
      get: (id) => secrets.get(id) ?? null,
      has: (id) => secrets.has(id),
      delete: (id) => secrets.delete(id),
    },
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path) ?? '',
    writeFile: (path, data) => files.set(path, data),
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    tempSuffix: () => 'tmp',
    mkdir: (path) => files.set(path, ''),
    rmrf: vi.fn((path: string) => files.delete(path)),
    createClaudeDir: (name) => claudeAccount(join(HOME, `.claude-${name}`)),
    deleteClaudeDir: vi.fn(),
  };
  return { service: new ProviderAccountService(deps), files, secrets, deps };
}

describe('ProviderAccountService', () => {
  it('create_claudePorApi_configDirPropioClaveEnLaBovedaYMarcaApi', () => {
    const { service, secrets } = setup();

    const account = service.create({ providerId: 'claude', authKind: 'api-key', name: 'api', apiKey: ' sk-ant-1 ' });

    expect(account).toMatchObject({ configDir: join(HOME, '.claude-api'), providerId: 'claude', authKind: 'api-key', loginStatus: 'logged_in' });
    expect(secrets.get(accountApiKeySecretId('claude', join(HOME, '.claude-api')))).toBe('sk-ant-1');
  });

  it('create_codexSuscripcion_codexHomePropioSinClaveYSinLogin', () => {
    const { service, secrets } = setup();

    const account = service.create({ providerId: 'codex', authKind: 'subscription', name: 'chatgpt' });

    expect(account).toMatchObject({ configDir: join(HOME, '.codex-chatgpt'), name: '.codex-chatgpt', providerId: 'codex', loginStatus: 'logged_out' });
    expect(secrets.size).toBe(0);
  });

  it('create_agyPorClave_perfilEnUserData', () => {
    const { service } = setup();

    const account = service.create({ providerId: 'agy', authKind: 'api-key', name: 'gem', apiKey: 'gm-1' });

    expect(account).toMatchObject({ configDir: join(USER_DATA, 'agy-accounts', 'gem'), name: 'agy-gem', providerId: 'agy', authKind: 'api-key' });
  });

  it('create_agySuscripcion_perfilPropioSinSesionHastaQueExisteElFicheroDeToken', () => {
    const { service, files } = setup();

    const account = service.create({ providerId: 'agy', authKind: 'subscription', name: 'personal' });
    const home = join(USER_DATA, 'agy-accounts', 'personal');
    const before = service.list([]).find((a) => a.configDir === home);
    files.set(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'x');
    const after = service.list([]).find((a) => a.configDir === home);

    expect(account).toMatchObject({ configDir: home, name: 'agy-personal', providerId: 'agy', authKind: 'subscription', loginStatus: 'logged_out' });
    expect(before?.loginStatus).toBe('logged_out');
    expect(after?.loginStatus).toBe('logged_in');
  });

  it.each([
    [{ providerId: 'claude', authKind: 'subscription', name: 'x' }, /no se da de alta/],
    [{ providerId: 'codex', authKind: 'api-key', name: 'x' }, /Falta la clave/],
    [{ providerId: 'codex', authKind: 'api-key', name: '1mal' }, /Nombre de cuenta invalido/],
  ] as const)('create_entradaInvalida_lanza_%#', (params, error) => {
    expect(() => setup().service.create(params)).toThrow(error);
  });

  it('create_errorDeClave_noCitaLaClave', () => {
    expect(() => setup().service.create({ providerId: 'codex', authKind: 'api-key', name: 'x', apiKey: '   ' })).toThrow(/^Falta la clave de API de la cuenta$/);
  });

  it('create_cuentaYaExistente_lanzaConLaRuta', () => {
    const { service } = setup();
    service.create({ providerId: 'codex', authKind: 'subscription', name: 'a' });

    expect(() => service.create({ providerId: 'codex', authKind: 'subscription', name: 'a' })).toThrow(/\.codex-a/);
  });

  it('list_claudeDeApiDescubierta_laMarcaYAnadeLasDemas', () => {
    const { service } = setup();
    service.create({ providerId: 'claude', authKind: 'api-key', name: 'api', apiKey: 'k' });
    service.create({ providerId: 'codex', authKind: 'api-key', name: 'oa', apiKey: 'k2' });

    const list = service.list([claudeAccount(join(HOME, '.claude')), claudeAccount(join(HOME, '.claude-api'))]);

    expect(list.map((a) => [a.providerId, a.authKind])).toEqual([
      ['claude', 'subscription'],
      ['claude', 'api-key'],
      ['codex', 'api-key'],
    ]);
  });

  it('apiKeyFor_suscripcionOtroProveedorOVacia_null', () => {
    const { service } = setup();
    service.create({ providerId: 'claude', authKind: 'api-key', name: 'api', apiKey: 'k' });

    expect(service.apiKeyFor('claude', join(HOME, '.claude'))).toBeNull();
    expect(service.apiKeyFor('agy', join(HOME, '.claude-api'))).toBeNull();
    expect(service.apiKeyFor('claude', '')).toBeNull();
  });

  // El perfil privado factura como su cuenta: recibe su clave.
  it('apiKeyFor_perfilPrivadoDeUnaCuentaDeApi_laClaveDeSuCuenta', () => {
    const { service } = setup();
    service.create({ providerId: 'claude', authKind: 'api-key', name: 'api', apiKey: 'k' });

    expect(service.apiKeyFor('claude', join(HOME, '.claude-api', 'mage-private'))).toBe('k');
  });

  it('apiKeyFor_cuentaDeApiSinClaveEnLaBoveda_lanza', () => {
    const { service, secrets } = setup();
    service.create({ providerId: 'codex', authKind: 'api-key', name: 'oa', apiKey: 'k' });
    secrets.clear();

    expect(() => service.apiKeyFor('codex', join(HOME, '.codex-oa'))).toThrow(/no tiene clave/);
  });

  it('delete_cuentaDelRegistro_borraCarpetaClaveYEntrada', () => {
    const { service, secrets, deps } = setup();
    service.create({ providerId: 'codex', authKind: 'api-key', name: 'oa', apiKey: 'k' });

    expect(service.delete(join(HOME, '.codex-oa'))).toBe(true);
    expect(deps.rmrf).toHaveBeenCalledWith(join(HOME, '.codex-oa'));
    expect(secrets.size).toBe(0);
    expect(service.list([])).toEqual([]);
  });

  it('delete_claudeDeApi_loBorraAccountService', () => {
    const { service, deps } = setup();
    service.create({ providerId: 'claude', authKind: 'api-key', name: 'api', apiKey: 'k' });

    service.delete(join(HOME, '.claude-api'));

    expect(deps.deleteClaudeDir).toHaveBeenCalledWith(join(HOME, '.claude-api'));
  });

  it('delete_cuentaQueNoEsDelRegistro_false', () => {
    expect(setup().service.delete(join(HOME, '.claude'))).toBe(false);
  });

  it('list_registroCorrupto_lanzaEnVezDeOlvidarLasCuentas', () => {
    const { service, files, deps } = setup();
    files.set(deps.filePath, '{roto');

    expect(() => service.list([])).toThrow(/no es JSON valido/);
  });
});
