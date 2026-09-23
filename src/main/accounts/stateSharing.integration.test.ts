// Tests de INTEGRACION del grupo G (integridad de la compartición de estado): observan el MECANISMO
// sobre el FS real, no con mocks. Son la excepcion justificada a "FS mockeado" de los estandares: el
// fallo que corrigen era precisamente del FS real (tmp+rename destruyendo enlaces, junctions
// convertidos en directorios), y con mocks se puede demostrar cualquier cosa.
// Montan un HOME de mentira bajo el temp del SO (mkdtemp, se borra en cada afterEach), fuerzan la
// divergencia a mano en cada direccion y comprueban EN DISCO con que token queda cada lado.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService, type AccountDeps } from './accountService';
import { defaultLinkDeps, LinkService } from '../os/linkService';
import type { LogLevel } from '@shared/debug';

let home: string;
let logs: Array<{ level: LogLevel; message: string }>;

function credentials(expiresAt: number, empty = false): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: empty ? '' : `access-${expiresAt}`,
      refreshToken: empty ? '' : `refresh-${expiresAt}`,
      expiresAt: empty ? 0 : expiresAt,
      scopes: ['user:inference'],
      subscriptionType: 'team',
    },
  });
}

function expiryOnDisk(path: string): number {
  return JSON.parse(readFileSync(path, 'utf8')).claudeAiOauth.expiresAt;
}

// Layout del proveedor bajo prueba. Va explicito (y no importado del adapter) para que un cambio
// en el adapter de Claude no mueva en silencio lo que estos tests afirman.
const LAYOUT = { configDirEnvVar: 'CLAUDE_CONFIG_DIR', mainDirName: '.claude', stateFileName: '.claude.json' };

function realDeps(): AccountDeps {
  const log = (level: LogLevel, message: string): void => {
    logs.push({ level, message });
  };
  return {
    layout: LAYOUT,
    homedir: home,
    listHome: () => [],
    isDirectory: (p) => existsSync(p) && statSync(p).isDirectory(),
    exists: existsSync,
    readJson: (p) => {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        return null;
      }
    },
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => writeFileSync(p, c),
    rmrf: (p) => rmSync(p, { recursive: true, force: true }),
    copyCredentialsFile: (from, to) => {
      const tmp = `${to}.verify.tmp`;
      copyFileSync(from, tmp);
      renameSync(tmp, to);
    },
    now: () => 1_000,
    linkService: new LinkService(defaultLinkDeps((level, message) => log(level, message))),
    log,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mage-verify-'));
  logs = [];
  mkdirSync(join(home, '.claude'), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('VERIFICACION G1/G2 sobre FS real', () => {
  it('divergenciaEnElPerfil_arrancaConElTokenMasReciente_yQuedaCoherenteEnAmbasRutas', () => {
    const account = join(home, '.claude-p');
    mkdirSync(account, { recursive: true });
    const accountCreds = join(account, '.credentials.json');
    const profileCreds = join(account, 'mage-private', '.credentials.json');
    // Divergencia forzada A MANO: la cuenta tiene el token bueno; el perfil, el vaciado por el CLI
    // (escrito DESPUES, o sea mas reciente en disco).
    writeFileSync(accountCreds, credentials(9_000));
    mkdirSync(join(account, 'mage-private'), { recursive: true });
    writeFileSync(profileCreds, credentials(0, true));

    const service = new AccountService(realDeps());
    service.ensurePrivateProfile(account);

    expect(expiryOnDisk(profileCreds)).toBe(9_000); // el perfil arranca con el token bueno
    expect(expiryOnDisk(accountCreds)).toBe(9_000); // y la cuenta NO se pisa
    expect(logs.some((l) => l.level === 'info' && l.message.includes('convergidas'))).toBe(true);
  });

  it('divergenciaEnLaCuenta_convergeHaciaLaCuenta_sinPerderElRefreshRotado', () => {
    const account = join(home, '.claude-p');
    mkdirSync(join(account, 'mage-private'), { recursive: true });
    const accountCreds = join(account, '.credentials.json');
    const profileCreds = join(account, 'mage-private', '.credentials.json');
    // Ahora fue la sesion PRIVADA la que refresco: el token bueno esta en el perfil.
    writeFileSync(accountCreds, credentials(5_000));
    writeFileSync(profileCreds, credentials(9_000));

    const service = new AccountService(realDeps());
    service.ensurePrivateProfile(account);

    expect(expiryOnDisk(accountCreds)).toBe(9_000); // se recupera en la cuenta
    expect(expiryOnDisk(profileCreds)).toBe(9_000);
  });

  it('sinDivergencia_noReescribeNinguno', () => {
    const account = join(home, '.claude-p');
    mkdirSync(join(account, 'mage-private'), { recursive: true });
    const accountCreds = join(account, '.credentials.json');
    const profileCreds = join(account, 'mage-private', '.credentials.json');
    writeFileSync(accountCreds, credentials(7_000));
    writeFileSync(profileCreds, credentials(7_000));
    const mtimeBefore = statSync(profileCreds).mtimeMs;

    const service = new AccountService(realDeps());
    service.ensurePrivateProfile(account);

    expect(statSync(profileCreds).mtimeMs).toBe(mtimeBefore); // ni un rename de mas
  });
});

describe('VERIFICACION G3 sobre FS real', () => {
  it('enlaceCompartidoConvertidoEnDirReal_produceUnEfectoObservable', () => {
    const account = join(home, '.claude-p');
    mkdirSync(account, { recursive: true });
    const service = new AccountService(realDeps());
    // Primera pasada: crea los enlaces del perfil privado de verdad (junction en Windows).
    const profile = service.ensurePrivateProfile(account);
    const shared = join(profile, 'sessions');
    expect(existsSync(shared)).toBe(true);

    // Se reproduce el fallo: una sesion viva convierte el enlace en DIRECTORIO REAL con datos propios.
    rmSync(shared, { recursive: true, force: true });
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, 'sesion-viva.jsonl'), '{}');
    logs = [];

    service.ensurePrivateProfile(account);

    const warning = logs.find((l) => l.level === 'warn' && l.message.includes('sessions'));
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('directorio real');
    // Y no se destruye lo que la sesion habia escrito dentro.
    expect(existsSync(join(shared, 'sesion-viva.jsonl'))).toBe(true);
  });
});
