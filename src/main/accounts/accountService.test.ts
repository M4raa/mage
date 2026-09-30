import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AccountService, type AccountDeps } from './accountService';
import type { LinkService } from '../os/linkService';

const HOME = '/home/u';

// Layout del proveedor bajo prueba. Va explicito (y no importado del adapter) para que un cambio
// en el adapter de Claude no mueva en silencio lo que estos tests afirman.
const LAYOUT = { configDirEnvVar: 'CLAUDE_CONFIG_DIR', mainDirName: '.claude', stateFileName: '.claude.json' };


function deps(overrides: Partial<AccountDeps>): AccountDeps {
  return {
    layout: LAYOUT,
    homedir: HOME,
    listHome: () => [],
    listDir: () => [],
    isDirectory: () => true,
    exists: () => false,
    readJson: () => null,
    mkdir: () => undefined,
    writeFile: () => undefined,
    rmrf: () => undefined,
    copyCredentialsFile: () => undefined,
    log: () => undefined,
    now: () => 1_000,
    linkService: {
      createDirLink: vi.fn(),
      removeDirLink: vi.fn(),
      classifyLink: vi.fn(() => 'missing'),
    } as unknown as LinkService,
    ...overrides,
  };
}

// readJson enrutado por ruta exacta (lo que no este en el mapa devuelve null).
function jsonFrom(map: Record<string, unknown>): (path: string) => unknown {
  return (path) => (path in map ? map[path] : null);
}

describe('AccountService.listAccounts (descubrimiento)', () => {
  it('listAccounts_filtersToClaudeConfigDirs_excludesOthers', () => {
    const service = new AccountService(
      deps({ listHome: () => ['.claude', '.claude-p', '.config', 'Documents', '.claude.json'] }),
    );

    const names = service.listAccounts().map((a) => a.name);

    expect(names).toEqual(['.claude', '.claude-p']); // .config/Documents/.claude.json excluidos
  });

  it('listAccounts_sortsMainFirstThenByName', () => {
    const service = new AccountService(deps({ listHome: () => ['.claude-z', '.claude', '.claude-a'] }));

    const accounts = service.listAccounts();

    expect(accounts.map((a) => a.name)).toEqual(['.claude', '.claude-a', '.claude-z']);
    expect(accounts[0]!.isMain).toBe(true);
  });

  it('listAccounts_ignoresNonDirectoryEntries', () => {
    const service = new AccountService(
      deps({ listHome: () => ['.claude', '.claude-file'], isDirectory: (p) => !p.endsWith('.claude-file') }),
    );

    expect(service.listAccounts().map((a) => a.name)).toEqual(['.claude']);
  });
});

// Lo que 9.1 vino a arreglar: AccountService ya no conoce ningun nombre de proveedor. Estos tests usan
// un layout INVENTADO a proposito — si alguien vuelve a cablear `.claude` dentro del servicio, fallan.
// Fase 9.2: quien ya usa Claude Code tiene ~/.claude logueado; su primera cuenta extra en Mage no
// deberia obligarle a iniciar sesion otra vez.
// Fase 7.8: que pasa cuando el SISTEMA falla, no el usuario. Los dos caminos que faltaban por probar
// son justo los que existen por un fallo real medido en Windows.
describe('AccountService: fallos del sistema (7.8)', () => {
  it('createAccount_siFallaUnEnlaceCompartido_propagaElFalloYNoDevuelveUnaCuentaAMedias', () => {
    // Un enlace que no se puede crear deja la cuenta SIN datos comunes (projects, sessions, skills...).
    // Devolverla igual seria peor que fallar: el usuario la veria en el rail y no funcionaria.
    const service = new AccountService(
      deps({
        linkService: {
          createDirLink: vi.fn(() => {
            throw new Error('EPERM: junction denegado');
          }),
        } as unknown as LinkService,
      }),
    );

    expect(() => service.createAccount('trabajo')).toThrow(/EPERM/);
  });

  it('createAccount_nombresInvalidos_lanzanCitandoLoRecibido', () => {
    const service = new AccountService(deps({}));

    // Un nombre con separadores de ruta es el caso peligroso: acabaria creando dirs fuera de HOME.
    for (const malo of ['', '   ', '1empieza-por-numero', 'con espacio', '../fuera', 'con/barra']) {
      expect(() => service.createAccount(malo)).toThrow(/invalido/i);
    }
  });

  it('createAccount_cuentaYaExistente_lanzaAntesDeTocarNada', () => {
    const mkdir = vi.fn();
    const service = new AccountService(deps({ exists: () => true, mkdir }));

    expect(() => service.createAccount('trabajo')).toThrow(/ya existe/i);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('ensurePrivateProfile_siLaCopiaDeCredencialesFalla_propagaEnVezDeSeguirComoSiNada', () => {
    // ESTE es el escenario para el que existe el modulo de convergencia: en Windows el CLI puede tener
    // el .credentials.json abierto y la copia falla con EBUSY. Tragarselo dejaria al perfil privado
    // arrancando con un token viejo (o sin ninguno) y el fallo apareceria tres pantallas despues, como
    // "sesion caducada" en una cuenta que acaba de loguearse.
    const VIVA = { claudeAiOauth: { accessToken: 'at', refreshToken: 'rt', expiresAt: 9_999_999 } };
    const service = new AccountService(
      deps({
        exists: () => true,
        readJson: jsonFrom({ [join(HOME, '.claude-p', '.credentials.json')]: VIVA }),
        copyCredentialsFile: vi.fn(() => {
          throw new Error('EBUSY: fichero en uso por otro proceso');
        }),
      }),
    );

    expect(() => service.ensurePrivateProfile(join(HOME, '.claude-p'))).toThrow(/EBUSY/);
  });

  it('ensureCredentialsFor_dirQueNoEsPerfilPrivado_noConvergeNada', () => {
    // Guard clause: solo los perfiles privados convergen. Sobre el dir de una cuenta no hay nada que
    // hacer, y hacerlo "por si acaso" copiaria credenciales entre cuentas DISTINTAS.
    const copy = vi.fn();
    const service = new AccountService(deps({ exists: () => true, copyCredentialsFile: copy }));

    service.ensureCredentialsFor(join(HOME, '.claude-p'));

    expect(copy).not.toHaveBeenCalled();
  });

  it('ensureCredentialsFor_perfilPrivadoDeUnaCuentaNoGestionada_lanza', () => {
    const service = new AccountService(deps({ exists: () => true }));

    expect(() => service.ensureCredentialsFor(join('/tmp/lo-que-sea', 'mage-private'))).toThrow(/no valida/i);
  });

  it('deleteAccount_siQuedaAlgunEnlaceVivo_abortaSinBorrarNada', () => {
    // Si un enlace compartido no se pudo quitar, un rmrf recursivo se llevaria por delante los datos
    // COMUNES (projects/sessions/skills de TODAS las cuentas). Mejor abortar y decirlo.
    const rmrf = vi.fn();
    const service = new AccountService(
      deps({
        exists: () => true,
        rmrf,
        linkService: {
          createDirLink: vi.fn(),
          removeDirLink: vi.fn(),
          classifyLink: vi.fn(() => 'link'), // sigue siendo un enlace tras intentar quitarlo
        } as unknown as LinkService,
      }),
    );

    expect(() => service.deleteAccount(join(HOME, '.claude-p'))).toThrow(/no se pudo desenlazar/i);
    expect(rmrf).not.toHaveBeenCalled();
  });
});

describe('AccountService.adoptLogin (9.2)', () => {
  const SOURCE = join(HOME, '.claude');
  const TARGET = join(HOME, '.claude-work');
  const VIVA = { claudeAiOauth: { accessToken: 'at', refreshToken: 'rt', expiresAt: 9_999_999 } };

  function service(overrides: Partial<AccountDeps> = {}): { service: AccountService; copy: ReturnType<typeof vi.fn> } {
    const copy = vi.fn();
    return {
      copy,
      service: new AccountService(
        deps({
          exists: () => true,
          readJson: jsonFrom({ [join(SOURCE, '.credentials.json')]: VIVA }),
          copyCredentialsFile: copy,
          ...overrides,
        }),
      ),
    };
  }

  it('adoptLogin_origenConSesionViva_copiaSusCredencialesAlDestino', () => {
    const { service: svc, copy } = service();

    svc.adoptLogin(SOURCE, TARGET);

    expect(copy).toHaveBeenCalledWith(join(SOURCE, '.credentials.json'), join(TARGET, '.credentials.json'));
  });

  it('adoptLogin_origenSinFicheroDeCredenciales_lanzaYNoCopia', () => {
    const { service: svc, copy } = service({ exists: (path) => !path.endsWith('.credentials.json') });

    expect(() => svc.adoptLogin(SOURCE, TARGET)).toThrow(/sesion utilizable/i);
    expect(copy).not.toHaveBeenCalled();
  });

  it('adoptLogin_origenVaciadoPorElCli_lanzaEnVezDeCopiarUnLoginQueNoVale', () => {
    // Caso REAL del grupo G: al fallar un refresh, el CLI deja tokens vacios y expiresAt 0. Copiarlo
    // dejaria la cuenta nueva con un login que PARECE existir y no sirve — peor que no tener ninguno.
    const vacio = { claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } };
    const { service: svc, copy } = service({ readJson: jsonFrom({ [join(SOURCE, '.credentials.json')]: vacio }) });

    expect(() => svc.adoptLogin(SOURCE, TARGET)).toThrow(/sesion utilizable/i);
    expect(copy).not.toHaveBeenCalled();
  });

  it('adoptLogin_rutaFueraDeHome_lanza', () => {
    const { service: svc } = service();

    expect(() => svc.adoptLogin('/tmp/lo-que-sea', TARGET)).toThrow(/no valida/i);
  });

  it('adoptLogin_mismoOrigenYDestino_lanza', () => {
    const { service: svc } = service();

    expect(() => svc.adoptLogin(SOURCE, SOURCE)).toThrow(/misma cuenta/i);
  });

  it('adoptLogin_rutaVacia_lanza', () => {
    const { service: svc } = service();

    expect(() => svc.adoptLogin('  ', TARGET)).toThrow(/vacio/i);
  });
});

describe('AccountService (layout del proveedor, 9.1)', () => {
  const OTHER = { configDirEnvVar: 'OTRO_CONFIG_DIR', mainDirName: '.otro', stateFileName: '.otro.json' };

  it('listAccounts_layoutDeOtroProveedor_descubreSusDirsYNoLosDeClaude', () => {
    const service = new AccountService(
      deps({ layout: OTHER, listHome: () => ['.otro', '.otro-work', '.otro2', '.claude', '.claude-p'] }),
    );

    const names = service.listAccounts().map((a) => a.name);

    expect(names).toEqual(['.otro', '.otro-work', '.otro2']); // los de Claude ya no son cuentas aqui
  });

  it('listAccounts_puntoDelNombreEscapado_noTratapreFijosParecidosComoCuentas', () => {
    // El '.' del nombre va dentro de una RegExp: sin escapar, 'xotro' pasaria por ser '.' un comodin.
    const service = new AccountService(deps({ layout: OTHER, listHome: () => ['.otro', 'xotro', 'Xotro-a'] }));

    expect(service.listAccounts().map((a) => a.name)).toEqual(['.otro']);
  });

  it('createAccount_layoutDeOtroProveedor_usaSuPrefijoYEnlazaContraSuDirPrincipal', () => {
    const createDirLink = vi.fn();
    const service = new AccountService(
      deps({ layout: OTHER, linkService: { createDirLink } as unknown as LinkService }),
    );

    const account = service.createAccount('work');

    expect(account.configDir).toBe(join(HOME, '.otro-work'));
    expect(createDirLink).toHaveBeenCalledWith(join(HOME, '.otro', 'projects'), join(HOME, '.otro-work', 'projects'));
  });

  it('describeAccount_layoutDeOtroProveedor_leeElEmailDeSuFicheroDeEstado', () => {
    const service = new AccountService(
      deps({
        layout: OTHER,
        listHome: () => ['.otro-work'],
        readJson: jsonFrom({
          [join(HOME, '.otro-work', '.otro.json')]: { oauthAccount: { emailAddress: 'a@b.c' } },
        }),
      }),
    );

    expect(service.listAccounts()[0]!.email).toBe('a@b.c');
  });

  it('constructor_mainDirNameVacio_lanzaConElLayoutRecibido', () => {
    const roto = { ...OTHER, mainDirName: '   ' };

    expect(() => new AccountService(deps({ layout: roto }))).toThrow(/mainDirName/);
  });
});

describe('AccountService.listAccounts (email/org por ubicacion)', () => {
  it('describe_mainAccount_readsClaudeJsonFromHomeRoot', () => {
    const service = new AccountService(
      deps({
        listHome: () => ['.claude'],
        readJson: jsonFrom({
          [join(HOME, '.claude.json')]: { oauthAccount: { emailAddress: 'a@b.com', organizationName: 'Org' } },
        }),
      }),
    );

    const main = service.listAccounts()[0]!;

    expect(main.email).toBe('a@b.com');
    expect(main.org).toBe('Org');
  });

  it('describe_altAccount_readsClaudeJsonInsideDir', () => {
    const service = new AccountService(
      deps({
        listHome: () => ['.claude-p'],
        readJson: jsonFrom({
          [join(HOME, '.claude-p', '.claude.json')]: { oauthAccount: { emailAddress: 'p@x.com' } },
        }),
      }),
    );

    const alt = service.listAccounts()[0]!;

    expect(alt.email).toBe('p@x.com');
    expect(alt.org).toBeNull();
    expect(alt.isMain).toBe(false);
  });

  it('describe_missingClaudeJson_emailAndOrgNull', () => {
    const service = new AccountService(deps({ listHome: () => ['.claude'] }));

    const main = service.listAccounts()[0]!;

    expect(main.email).toBeNull();
    expect(main.org).toBeNull();
  });
});

describe('AccountService.listAccounts (estado de login)', () => {
  it('login_noCredentials_loggedOut', () => {
    const service = new AccountService(deps({ listHome: () => ['.claude'], exists: () => false }));

    const main = service.listAccounts()[0]!;

    expect(main.loginStatus).toBe('logged_out');
    expect(main.expiresAt).toBeNull();
  });

  it('login_credentialsFutureExpiry_loggedIn', () => {
    const creds = join(HOME, '.claude', '.credentials.json');
    const service = new AccountService(
      deps({
        listHome: () => ['.claude'],
        now: () => 1_000,
        exists: (p) => p === creds,
        readJson: jsonFrom({ [creds]: { claudeAiOauth: { expiresAt: 5_000 } } }),
      }),
    );

    const main = service.listAccounts()[0]!;

    expect(main.loginStatus).toBe('logged_in');
    expect(main.expiresAt).toBe(5_000);
  });

  it('login_credentialsPastExpiry_expired', () => {
    const creds = join(HOME, '.claude', '.credentials.json');
    const service = new AccountService(
      deps({
        listHome: () => ['.claude'],
        now: () => 10_000,
        exists: (p) => p === creds,
        readJson: jsonFrom({ [creds]: { claudeAiOauth: { expiresAt: 5_000 } } }),
      }),
    );

    expect(service.listAccounts()[0]!.loginStatus).toBe('expired');
  });

  it('login_credentialsWithoutExpiry_loggedInNullExpiry', () => {
    const creds = join(HOME, '.claude', '.credentials.json');
    const service = new AccountService(
      deps({
        listHome: () => ['.claude'],
        exists: (p) => p === creds,
        readJson: jsonFrom({ [creds]: { claudeAiOauth: {} } }),
      }),
    );

    const main = service.listAccounts()[0]!;

    expect(main.loginStatus).toBe('logged_in');
    expect(main.expiresAt).toBeNull();
  });
});

describe('AccountService.listAccounts (defaultModel)', () => {
  it('describe_settingsWithModel_readsDefaultModel', () => {
    const settings = join(HOME, '.claude', 'settings.json');
    const service = new AccountService(
      deps({ listHome: () => ['.claude'], readJson: jsonFrom({ [settings]: { model: 'opus' } }) }),
    );

    expect(service.listAccounts()[0]!.defaultModel).toBe('opus');
  });

  it('describe_noSettings_defaultModelNull', () => {
    const service = new AccountService(deps({ listHome: () => ['.claude'] }));

    expect(service.listAccounts()[0]!.defaultModel).toBeNull();
  });
});

describe('AccountService.createAccount', () => {
  it('createAccount_invalidName_throws', () => {
    const service = new AccountService(deps({}));

    expect(() => service.createAccount('9bad')).toThrow(/invalido/i);
    expect(() => service.createAccount('-x')).toThrow(/invalido/i);
    expect(() => service.createAccount('')).toThrow(/invalido/i);
  });

  it('createAccount_existingDir_throws', () => {
    const dir = join(HOME, '.claude-work');
    const service = new AccountService(deps({ exists: (p) => p === dir }));

    expect(() => service.createAccount('work')).toThrow(/ya existe/i);
  });

  it('createAccount_valid_createsDirLinksAndSeedSettings', () => {
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    const createDirLink = vi.fn();
    const service = new AccountService(
      deps({
        exists: () => false,
        mkdir,
        writeFile,
        linkService: { createDirLink } as unknown as LinkService,
      }),
    );

    const info = service.createAccount('work');

    expect(mkdir).toHaveBeenCalledWith(join(HOME, '.claude-work'));
    expect(createDirLink).toHaveBeenCalledTimes(8); // 8 carpetas compartidas (commands y agents desde P-026 2.6)
    expect(createDirLink).toHaveBeenCalledWith(
      join(HOME, '.claude', 'projects'),
      join(HOME, '.claude-work', 'projects'),
    );
    const [settingsPath, content] = writeFile.mock.calls[0]!;
    expect(settingsPath).toBe(join(HOME, '.claude-work', 'settings.json'));
    expect(content).toContain('"model": "sonnet"');
    expect(info.name).toBe('.claude-work');
    expect(info.isMain).toBe(false);
    expect(info.loginStatus).toBe('logged_out');
  });

  it('createAccount_settingsAlreadyExists_doesNotOverwrite', () => {
    const settings = join(HOME, '.claude-work', 'settings.json');
    const writeFile = vi.fn();
    // el dir NO existe (para pasar la guarda) pero settings.json SI existe -> no se re-siembra.
    const service = new AccountService(
      deps({ exists: (p) => p === settings, writeFile }),
    );

    service.createAccount('work');

    expect(writeFile).not.toHaveBeenCalled();
  });
});

// P-026 2.6 (D11): la semilla hereda de la principal lo que hace que las skills de plugin carguen.
describe('AccountService — semilla heredada', () => {
  const MAIN_SETTINGS = join(HOME, '.claude', 'settings.json');
  const MAIN = {
    model: 'opus[1m]',
    enabledPlugins: { 'obsidian@obsidian-skills': true },
    extraKnownMarketplaces: { 'obsidian-skills': { source: { source: 'github', repo: 'x/y' } } },
    permissions: { allow: ['Bash(git status)'] },
    statusLine: { type: 'command', command: 'algo' },
    theme: 'dark',
  };

  it('createAccount_heredaPluginsMarketplacesYPermisos', () => {
    const writeFile = vi.fn();
    const service = new AccountService(deps({ writeFile, readJson: jsonFrom({ [MAIN_SETTINGS]: MAIN }) }));

    service.createAccount('work');

    const seeded = JSON.parse(String(writeFile.mock.calls[0]?.[1]));
    expect(seeded).toEqual({
      model: 'sonnet',
      enabledPlugins: MAIN.enabledPlugins,
      extraKnownMarketplaces: MAIN.extraKnownMarketplaces,
      permissions: MAIN.permissions,
    });
  });

  it('createAccount_principalSinSettings_soloElModelo', () => {
    const writeFile = vi.fn();
    new AccountService(deps({ writeFile })).createAccount('work');

    expect(JSON.parse(String(writeFile.mock.calls[0]?.[1]))).toEqual({ model: 'sonnet' });
  });

  it('ensurePrivateProfile_semillaMinimaDeAntes_laCompletaConservandoElModelo', () => {
    // El perfil privado del usuario: `{"model":"sonnet"}` escrito por Mage, sin plugins (medido).
    const privateSettings = join(HOME, '.claude', 'mage-private', 'settings.json');
    const writeFile = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === privateSettings,
        writeFile,
        readJson: jsonFrom({ [MAIN_SETTINGS]: MAIN, [privateSettings]: { model: 'haiku' } }),
      }),
    );

    service.ensurePrivateProfile(join(HOME, '.claude'));

    const [path, content] = writeFile.mock.calls.find(([p]) => p === privateSettings) ?? [];
    expect(path).toBe(privateSettings);
    expect(JSON.parse(String(content))).toMatchObject({ model: 'haiku', enabledPlugins: MAIN.enabledPlugins });
  });

  it('ensurePrivateProfile_settingsEditadoPorElUsuario_noLoToca', () => {
    const privateSettings = join(HOME, '.claude', 'mage-private', 'settings.json');
    const writeFile = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === privateSettings,
        writeFile,
        readJson: jsonFrom({ [MAIN_SETTINGS]: MAIN, [privateSettings]: { model: 'haiku', theme: 'light' } }),
      }),
    );

    service.ensurePrivateProfile(join(HOME, '.claude'));

    expect(writeFile.mock.calls.some(([p]) => p === privateSettings)).toBe(false);
  });

  it('ensurePrivateProfile_semillaMinimaYPrincipalSinNadaQueHeredar_noEscribe', () => {
    const privateSettings = join(HOME, '.claude', 'mage-private', 'settings.json');
    const writeFile = vi.fn();
    const service = new AccountService(
      deps({ exists: (p) => p === privateSettings, writeFile, readJson: jsonFrom({ [privateSettings]: { model: 'sonnet' } }) }),
    );

    service.ensurePrivateProfile(join(HOME, '.claude'));

    expect(writeFile.mock.calls.some(([p]) => p === privateSettings)).toBe(false);
  });

  it('createAccount_comparteCommandsYAgents', () => {
    const createDirLink = vi.fn();
    new AccountService(deps({ linkService: { createDirLink } as unknown as LinkService })).createAccount('work');

    expect(createDirLink).toHaveBeenCalledWith(join(HOME, '.claude', 'commands'), join(HOME, '.claude-work', 'commands'));
    expect(createDirLink).toHaveBeenCalledWith(join(HOME, '.claude', 'agents'), join(HOME, '.claude-work', 'agents'));
  });
});

describe('AccountService.deleteAccount', () => {
  it('deleteAccount_mainAccount_throws', () => {
    const service = new AccountService(deps({ exists: () => true }));

    expect(() => service.deleteAccount(join(HOME, '.claude'))).toThrow(/principal/i);
  });

  it('deleteAccount_missingDir_throws', () => {
    const service = new AccountService(deps({ exists: () => false }));

    expect(() => service.deleteAccount(join(HOME, '.claude-p'))).toThrow(/no existe/i);
  });

  it('deleteAccount_pathOutsideHome_throws', () => {
    const service = new AccountService(deps({ exists: () => true }));

    expect(() => service.deleteAccount('/tmp/.claude-evil')).toThrow(/no valida/i);
  });

  it('deleteAccount_valid_unlinksSharedThenRemovesDir', () => {
    const dir = join(HOME, '.claude-p');
    const rmrf = vi.fn();
    const removeDirLink = vi.fn();
    const service = new AccountService(
      deps({
        exists: () => true,
        rmrf,
        linkService: { removeDirLink, classifyLink: () => 'missing' } as unknown as LinkService,
      }),
    );

    service.deleteAccount(dir);

    // 8 compartidas de la cuenta + 7 del perfil privado (mage-private, sin projects) = 15.
    expect(removeDirLink).toHaveBeenCalledTimes(15);
    expect(removeDirLink).toHaveBeenCalledWith(join(dir, 'projects'));
    expect(removeDirLink).toHaveBeenCalledWith(join(dir, 'mage-private', 'sessions'));
    expect(rmrf).toHaveBeenCalledWith(dir);
  });

  it('deleteAccount_sharedLinkRemains_abortsWithoutRemovingDir', () => {
    const dir = join(HOME, '.claude-p');
    const rmrf = vi.fn();
    // classifyLink sigue devolviendo 'link' -> no se pudo desenlazar -> abortar (no borrar dir).
    const service = new AccountService(
      deps({
        exists: () => true,
        rmrf,
        linkService: { removeDirLink: vi.fn(), classifyLink: () => 'link' } as unknown as LinkService,
      }),
    );

    expect(() => service.deleteAccount(dir)).toThrow(/desenlazar/i);
    expect(rmrf).not.toHaveBeenCalled();
  });

  it('deleteAccount_carpetaCompartidaRealNoVacia_abortaConLaRutaSinTocarNada', () => {
    // Arrange: `projects` dejo de ser enlace (el CLI lo recreo como dir real) y tiene datos.
    const dir = join(HOME, '.claude-p');
    const projects = join(dir, 'projects');
    const rmrf = vi.fn();
    const removeDirLink = vi.fn();
    const service = new AccountService(
      deps({
        exists: () => true,
        rmrf,
        listDir: (p) => (p === projects ? ['conv.jsonl'] : []),
        linkService: {
          removeDirLink,
          classifyLink: (p: string) => (p === projects ? 'private' : 'link'),
        } as unknown as LinkService,
      }),
    );

    // Act + Assert: aborta ANTES de desenlazar nada, con la ruta en el mensaje.
    expect(() => service.deleteAccount(dir)).toThrow(projects);
    expect(removeDirLink).not.toHaveBeenCalled();
    expect(rmrf).not.toHaveBeenCalled();
  });

  it('deleteAccount_carpetaCompartidaRealVacia_borra', () => {
    const dir = join(HOME, '.claude-p');
    const rmrf = vi.fn();
    const service = new AccountService(
      deps({
        exists: () => true,
        rmrf,
        listDir: () => [],
        linkService: { removeDirLink: vi.fn(), classifyLink: () => 'private' } as unknown as LinkService,
      }),
    );

    service.deleteAccount(dir);

    expect(rmrf).toHaveBeenCalledWith(dir);
  });

  it('deleteAccount_cuentaNoCreadaPorMage_seBorraIgual', () => {
    // Cualquier dir `.claude<N>` / `.claude-*` que Mage descubre se puede borrar (rectificacion del 30).
    const dir = join(HOME, '.claude2');
    const rmrf = vi.fn();
    const service = new AccountService(deps({ exists: () => true, rmrf }));

    service.deleteAccount(dir);

    expect(rmrf).toHaveBeenCalledWith(dir);
  });
});

describe('AccountService.ensurePrivateProfile (M2.6)', () => {
  it('ensurePrivateProfile_emptyDir_throws', () => {
    const service = new AccountService(deps({}));

    expect(() => service.ensurePrivateProfile('   ')).toThrow(/vacio/i);
  });

  it('ensurePrivateProfile_unmanagedDir_throws', () => {
    const service = new AccountService(deps({}));

    expect(() => service.ensurePrivateProfile('/tmp/.claude-evil')).toThrow(/no valida/i);
  });

  it('ensurePrivateProfile_valid_createsPrivateProjectsAndSharedLinks', () => {
    const dir = join(HOME, '.claude-p');
    const profile = join(dir, 'mage-private');
    const mkdir = vi.fn();
    const createDirLink = vi.fn();
    const service = new AccountService(
      deps({ exists: () => false, mkdir, linkService: { createDirLink } as unknown as LinkService }),
    );

    const result = service.ensurePrivateProfile(dir);

    expect(result).toBe(profile);
    expect(mkdir).toHaveBeenCalledWith(join(profile, 'projects')); // projects PRIVADO real
    expect(createDirLink).toHaveBeenCalledTimes(7); // 8 compartidas MENOS projects
    // projects NO se enlaza (es lo que se aisla); sessions si (ejemplo de compartida).
    expect(createDirLink).not.toHaveBeenCalledWith(
      join(HOME, '.claude', 'projects'),
      join(profile, 'projects'),
    );
    expect(createDirLink).toHaveBeenCalledWith(join(HOME, '.claude', 'sessions'), join(profile, 'sessions'));
  });

  // Credenciales validas de mentira (solo la forma que mira la convergencia; tokens de relleno).
  function credentialsJson(expiresAt: number): unknown {
    return { claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt } };
  }

  it('ensurePrivateProfile_onlyAccountHasCredentials_copiesThemIntoProfile', () => {
    const dir = join(HOME, '.claude-p');
    const creds = join(dir, '.credentials.json');
    const target = join(dir, 'mage-private', '.credentials.json');
    const copyCredentialsFile = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === creds,
        readJson: jsonFrom({ [creds]: credentialsJson(9_000) }),
        copyCredentialsFile,
      }),
    );

    service.ensurePrivateProfile(dir);

    expect(copyCredentialsFile).toHaveBeenCalledWith(creds, target);
  });

  it('ensurePrivateProfile_profileHasFresherToken_copiesTowardsTheAccount', () => {
    // S2: si la sesion PRIVADA refresco el token, el bueno esta en el perfil. La direccion fija
    // cuenta->perfil de la version anterior lo habria destruido, dejando la cuenta sin login.
    const dir = join(HOME, '.claude-p');
    const creds = join(dir, '.credentials.json');
    const target = join(dir, 'mage-private', '.credentials.json');
    const copyCredentialsFile = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === creds || p === target,
        readJson: jsonFrom({ [creds]: credentialsJson(5_000), [target]: credentialsJson(9_000) }),
        copyCredentialsFile,
      }),
    );

    service.ensurePrivateProfile(dir);

    expect(copyCredentialsFile).toHaveBeenCalledWith(target, creds);
  });

  it('ensurePrivateProfile_profileEmptiedByCli_copiesAccountOverItAndLogsDirection', () => {
    // El fichero vaciado por el CLI (tokens vacios, expiresAt 0) es el mas reciente en disco; aun asi
    // debe perder. Y la convergencia tiene que quedar registrada, con su direccion.
    const dir = join(HOME, '.claude-p');
    const creds = join(dir, '.credentials.json');
    const target = join(dir, 'mage-private', '.credentials.json');
    const copyCredentialsFile = vi.fn();
    const log = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === creds || p === target,
        readJson: jsonFrom({
          [creds]: credentialsJson(9_000),
          [target]: { claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } },
        }),
        copyCredentialsFile,
        log,
      }),
    );

    service.ensurePrivateProfile(dir);

    expect(copyCredentialsFile).toHaveBeenCalledWith(creds, target);
    const infoCall = log.mock.calls.find(([level]) => level === 'info');
    expect(infoCall?.[1]).toContain(creds);
    expect(infoCall?.[1]).toContain(target);
  });

  it('ensurePrivateProfile_sameTokenOnBothSides_doesNotCopy', () => {
    // Estado ya coherente: no se escribe nada (cada escritura es un rename innecesario).
    const dir = join(HOME, '.claude-p');
    const creds = join(dir, '.credentials.json');
    const target = join(dir, 'mage-private', '.credentials.json');
    const copyCredentialsFile = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === creds || p === target,
        readJson: jsonFrom({ [creds]: credentialsJson(7_000), [target]: credentialsJson(7_000) }),
        copyCredentialsFile,
      }),
    );

    service.ensurePrivateProfile(dir);

    expect(copyCredentialsFile).not.toHaveBeenCalled();
  });

  it('ensurePrivateProfile_noCredentialsAnywhere_doesNotCopy', () => {
    const dir = join(HOME, '.claude-p');
    const copyCredentialsFile = vi.fn();
    const service = new AccountService(deps({ exists: () => false, copyCredentialsFile }));

    service.ensurePrivateProfile(dir);

    expect(copyCredentialsFile).not.toHaveBeenCalled();
  });

  it('ensureCredentialsFor_accountDir_doesNothing', () => {
    // Un dir de cuenta no tiene nada que converger: sus credenciales son la referencia.
    const copyCredentialsFile = vi.fn();
    const service = new AccountService(deps({ exists: () => true, copyCredentialsFile }));

    service.ensureCredentialsFor(join(HOME, '.claude-p'));

    expect(copyCredentialsFile).not.toHaveBeenCalled();
  });

  it('ensureCredentialsFor_privateProfile_convergesWithItsAccount', () => {
    const dir = join(HOME, '.claude-p');
    const profile = join(dir, 'mage-private');
    const creds = join(dir, '.credentials.json');
    const target = join(profile, '.credentials.json');
    const copyCredentialsFile = vi.fn();
    const service = new AccountService(
      deps({
        exists: (p) => p === creds,
        readJson: jsonFrom({ [creds]: { claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 9_000 } } }),
        copyCredentialsFile,
      }),
    );

    service.ensureCredentialsFor(profile);

    expect(copyCredentialsFile).toHaveBeenCalledWith(creds, target);
  });

  it('ensureCredentialsFor_privateProfileOutsideHome_throws', () => {
    const service = new AccountService(deps({}));

    expect(() => service.ensureCredentialsFor('/tmp/.claude-evil/mage-private')).toThrow(/no valida/i);
  });

  it('ensureCredentialsFor_emptyDir_throws', () => {
    const service = new AccountService(deps({}));

    expect(() => service.ensureCredentialsFor('  ')).toThrow(/vacio/i);
  });

  it('ensurePrivateProfile_mainAccount_allowed', () => {
    const dir = join(HOME, '.claude');
    const service = new AccountService(deps({ exists: () => false }));

    expect(service.ensurePrivateProfile(dir)).toBe(join(dir, 'mage-private'));
  });
});
