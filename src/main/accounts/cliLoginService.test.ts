import { describe, expect, it, vi } from 'vitest';
import { CliLoginService, parseAuthorizeUrl, parseAuthStatus, type CliLoginDeps, type CliLoginProcess } from './cliLoginService';

const DIR = '/home/u/.claude-work';
const URL_MANUAL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge_method=S256&state=abc';

// Salida REAL del CLI 2.1.270 (medida el 2026-09-14): la URL viaja dentro de un hyperlink OSC-8, asi
// que aparece DOS VECES seguidas y pegada a bytes de escape.
const SALIDA_REAL = `Opening browser to sign in…\nIf the browser didn't open, visit: ]8;;${URL_MANUAL}${URL_MANUAL}]8;;\nPaste code here if prompted > `;

const STATUS_CON_SESION = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  email: 'a@b.c',
  orgId: 'c683014d',
  orgName: 'gar.im',
  subscriptionType: 'team',
});
const STATUS_SIN_SESION = JSON.stringify({ loggedIn: false, authMethod: 'none' });

// Proceso falso: guarda lo escrito por stdin y deja disparar salida/exit desde el test.
function fakeProcess(): CliLoginProcess & { emit: (chunk: string) => void; exit: (code: number | null) => void; readonly written: string[] } {
  const outputs: ((chunk: string) => void)[] = [];
  const exits: ((code: number | null) => void)[] = [];
  const written: string[] = [];
  return {
    written,
    onOutput: (listener) => outputs.push(listener),
    onExit: (listener) => exits.push(listener),
    writeLine: (text) => written.push(text),
    kill: vi.fn(),
    emit: (chunk) => outputs.forEach((listener) => listener(chunk)),
    exit: (code) => exits.forEach((listener) => listener(code)),
  };
}

function deps(overrides: Partial<CliLoginDeps> = {}): CliLoginDeps {
  return {
    spawnLogin: () => fakeProcess(),
    readAuthStatus: async () => STATUS_CON_SESION,
    openPrivate: async () => 'private',
    validateConfigDir: () => true,
    urlTimeoutMs: 50,
    ...overrides,
  };
}

describe('parseAuthorizeUrl', () => {
  it('parseAuthorizeUrl_salidaRealConHyperlinkOsc8_devuelveUnaSolaUrl', () => {
    // El fallo que esto evita: un indexOf('https://') se lleva las DOS ocurrencias concatenadas.
    expect(parseAuthorizeUrl(SALIDA_REAL)).toBe(URL_MANUAL);
  });

  it('parseAuthorizeUrl_salidaParcialSinUrlTodavia_devuelveNull', () => {
    expect(parseAuthorizeUrl('Opening browser to sign in…\n')).toBeNull();
  });

  it('parseAuthorizeUrl_conCodigosDeColor_losIgnora', () => {
    expect(parseAuthorizeUrl(`[36m${URL_MANUAL}[0m`)).toBe(URL_MANUAL);
  });

  it('parseAuthorizeUrl_urlDeOtraCosa_noLaConfundeConLaDeAuthorize', () => {
    expect(parseAuthorizeUrl('visita https://claude.com/docs para mas informacion')).toBeNull();
  });
});

describe('parseAuthStatus', () => {
  it('parseAuthStatus_conSesion_sacaEmailYOrg', () => {
    expect(parseAuthStatus(STATUS_CON_SESION)).toEqual({ loggedIn: true, email: 'a@b.c', org: 'gar.im' });
  });

  it('parseAuthStatus_sinSesion_loggedInFalseYCamposNulos', () => {
    expect(parseAuthStatus(STATUS_SIN_SESION)).toEqual({ loggedIn: false, email: null, org: null });
  });

  it('parseAuthStatus_conRuidoAntesDelJson_loEncuentraIgual', () => {
    expect(parseAuthStatus(`aviso del CLI\n${STATUS_CON_SESION}`)?.loggedIn).toBe(true);
  });

  it('parseAuthStatus_salidaVaciaOJsonRoto_devuelveNullYNoLanza', () => {
    expect(parseAuthStatus('')).toBeNull();
    expect(parseAuthStatus('{ esto no es json')).toBeNull();
  });

  it('parseAuthStatus_sinCampoLoggedIn_devuelveNullEnVezDeSuponerQueNo', () => {
    // "No se sabe" y "no hay sesion" no son lo mismo: el llamador trata null como fallo explicito.
    expect(parseAuthStatus(JSON.stringify({ email: 'a@b.c' }))).toBeNull();
  });
});

describe('CliLoginService.start', () => {
  it('start_configDirNoGestionado_lanzaSinSpawnear', async () => {
    const spawnLogin = vi.fn(() => fakeProcess());

    await expect(new CliLoginService(deps({ validateConfigDir: () => false, spawnLogin })).start(DIR, null)).rejects.toThrow(/no valida/i);
    expect(spawnLogin).not.toHaveBeenCalled();
  });

  it('start_cuandoElCliImprimeLaUrl_laAbreEnPrivadoYLaDevuelve', async () => {
    const child = fakeProcess();
    const openPrivate = vi.fn(async () => 'private' as const);
    const service = new CliLoginService(deps({ spawnLogin: () => child, openPrivate }));

    const started = service.start(DIR, 'a@b.c');
    child.emit(SALIDA_REAL);

    expect(await started).toEqual({ authorizeUrl: URL_MANUAL, browser: 'private' });
    expect(openPrivate).toHaveBeenCalledWith(URL_MANUAL);
  });

  it('start_urlPartidaEnDosTrozos_laReconstruye', async () => {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child }));

    const started = service.start(DIR, null);
    child.emit(SALIDA_REAL.slice(0, 90));
    child.emit(SALIDA_REAL.slice(90));

    expect((await started).authorizeUrl).toBe(URL_MANUAL);
  });

  it('start_ventanaNoPrivada_loDevuelveComoAvisoNoComoFallo', async () => {
    const child = fakeProcess();
    const log = vi.fn();
    const service = new CliLoginService(deps({ spawnLogin: () => child, openPrivate: async () => 'normal', log }));

    const started = service.start(DIR, null);
    child.emit(SALIDA_REAL);

    expect((await started).browser).toBe('normal');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('ventana normal'));
  });

  it('start_elCliNoImprimeLaUrl_lanzaAlVencerElPlazoYMataElProceso', async () => {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child, urlTimeoutMs: 10 }));

    await expect(service.start(DIR, null)).rejects.toThrow(/no imprimio la URL/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it('start_elCliMuereAntesDeLaUrl_lanzaEnVezDeEsperarAlPlazo', async () => {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child, urlTimeoutMs: 10_000 }));

    const started = service.start(DIR, null);
    child.exit(1);

    await expect(started).rejects.toThrow(/termino \(codigo 1\)/i);
  });

  it('start_conOtroLoginEnCurso_lanza', async () => {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child }));
    const started = service.start(DIR, null);
    child.emit(SALIDA_REAL);
    await started;

    await expect(service.start('/home/u/.claude-otra', null)).rejects.toThrow(/en curso/i);
  });
});

describe('CliLoginService.submitCode', () => {
  // Arranca un login ya listo para recibir el code.
  async function started(overrides: Partial<CliLoginDeps> = {}): Promise<{
    service: CliLoginService;
    child: ReturnType<typeof fakeProcess>;
  }> {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child, ...overrides }));
    const pending = service.start(DIR, null);
    child.emit(SALIDA_REAL);
    await pending;
    return { service, child };
  }

  it('submitCode_sinLoginEnCurso_devuelveError', async () => {
    const result = await new CliLoginService(deps()).submitCode('abc123');

    expect(result).toEqual({ status: 'error', email: null, org: null, reason: 'no_login_in_progress' });
  });

  it('submitCode_codeValido_loRelayaPorStdinYVerificaConElCli', async () => {
    const { service, child } = await started();

    const result = await service.submitCode('  abc123#state  ');

    expect(child.written).toEqual(['abc123#state']); // sin espacios, una sola linea
    expect(result).toEqual({ status: 'ok', email: 'a@b.c', org: 'gar.im', reason: null });
  });

  it('submitCode_codeConEspaciosDentro_seRechazaEnLaFrontera', async () => {
    // Un salto de linea partiria el relay en dos y el CLI leeria basura como segunda respuesta.
    const { service, child } = await started();

    const result = await service.submitCode('abc 123');

    expect(result.reason).toBe('bad_code_format');
    expect(child.written).toEqual([]);
  });

  it('submitCode_codeVacio_seRechaza', async () => {
    const { service } = await started();

    expect((await service.submitCode('   ')).reason).toBe('bad_code_format');
  });

  it('submitCode_elCliDiceQueNoHaySesion_devuelveErrorEnVezDeOk', async () => {
    const { service } = await started({ readAuthStatus: async () => STATUS_SIN_SESION });

    expect(await service.submitCode('abc123')).toMatchObject({ status: 'error', reason: 'auth_status_not_logged_in' });
  });

  it('submitCode_authStatusIlegible_devuelveErrorNoUnOkAOscuras', async () => {
    const { service } = await started({ readAuthStatus: async () => 'sin json' });

    expect((await service.submitCode('abc123')).reason).toBe('auth_status_unreadable');
  });

  it('submitCode_authStatusLanza_seTrataComoIlegibleYNoPropaga', async () => {
    const { service } = await started({
      readAuthStatus: async () => {
        throw new Error('ENOENT');
      },
    });

    expect((await service.submitCode('abc123')).reason).toBe('auth_status_unreadable');
  });

  it('submitCode_trasTerminar_liberaElTurnoParaOtroLogin', async () => {
    const { service } = await started();
    await service.submitCode('abc123');

    // Si no se hubiera liberado, esto lanzaria "ya hay un login en curso".
    const otro = fakeProcess();
    const second = new CliLoginService(deps({ spawnLogin: () => otro }));
    const pending = second.start(DIR, null);
    otro.emit(SALIDA_REAL);

    await expect(pending).resolves.toBeDefined();
  });
});

describe('CliLoginService.cancel', () => {
  it('cancel_conLoginVivo_mataElProceso', async () => {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child }));
    const pending = service.start(DIR, null);
    child.emit(SALIDA_REAL);
    await pending;

    service.cancel();

    expect(child.kill).toHaveBeenCalled();
  });

  it('cancel_dosVeces_noVuelveAMatar', async () => {
    const child = fakeProcess();
    const service = new CliLoginService(deps({ spawnLogin: () => child }));
    const pending = service.start(DIR, null);
    child.emit(SALIDA_REAL);
    await pending;

    service.cancel();
    service.cancel();

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('cancel_sinLoginEnCurso_noHaceNada', () => {
    expect(() => new CliLoginService(deps()).cancel()).not.toThrow();
  });
});
