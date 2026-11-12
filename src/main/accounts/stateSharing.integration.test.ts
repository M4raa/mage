// Tests de INTEGRACION del grupo G (integridad de la compartición de estado): observan el MECANISMO
// sobre el FS real, no con mocks. Son la excepcion justificada a "FS mockeado" de los estandares: el
// fallo que corrigen era precisamente del FS real (tmp+rename destruyendo enlaces, junctions
// convertidos en directorios), y con mocks se puede demostrar cualquier cosa.
// Montan un HOME de mentira bajo el temp del SO (mkdtemp, se borra en cada afterEach), fuerzan la
// divergencia a mano en cada direccion y comprueban EN DISCO con que token queda cada lado.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService, type AccountDeps } from './accountService';
import { retiredProfileDirOf } from '../conversations/privateConversationsMigration';
import { defaultLinkDeps, LinkService } from '../os/linkService';
import type { LogLevel } from '@shared/debug';

let home: string;
let logs: Array<{ level: LogLevel; message: string }>;

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
    listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
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

// Punto 30 (P-028): borrar una cuenta con enlaces REALES (junction en Windows, symlink en POSIX).
describe('deleteAccount sobre FS real', () => {
  function accountWithSharedData(): { service: AccountService; account: string; commonFile: string } {
    const service = new AccountService(realDeps());
    const commonFile = join(home, '.claude', 'projects', 'p1', 'compartida.jsonl');
    mkdirSync(join(home, '.claude', 'projects', 'p1'), { recursive: true });
    writeFileSync(commonFile, '{}');
    const account = service.createAccount('p').configDir;
    // El perfil privado retirado, tal y como lo dejaron versiones anteriores: su `projects` propio y
    // enlaces de directorio al comun para el resto. Mage ya no lo crea, pero el borrado tiene que cruzarlo bien.
    const profile = retiredProfileDirOf(account);
    mkdirSync(join(profile, 'projects'), { recursive: true });
    writeFileSync(join(profile, 'projects', 'privada.jsonl'), '{}');
    const links = new LinkService(defaultLinkDeps(() => undefined));
    for (const folder of ['sessions', 'skills']) links.createDirLink(join(home, '.claude', folder), join(profile, folder));
    return { service, account, commonFile };
  }

  it('deleteAccount_conJunctionsReales_borraLaCuentaYSusPrivadasSinTocarLoComun', () => {
    const { service, account, commonFile } = accountWithSharedData();

    service.deleteAccount(account);

    expect(existsSync(account)).toBe(false);
    expect(existsSync(commonFile)).toBe(true);
  });

  it('deleteAccount_enlaceAjenoFueraDeSharedFolders_rmSyncNoEntraEnElDestino', () => {
    // MEDICION: un enlace de directorio que no es de Mage (p.ej. de un script del usuario) dentro de la
    // cuenta. `rmSync` recursivo tiene que quitar el enlace sin borrar lo que hay al otro lado.
    const { service, account } = accountWithSharedData();
    const outside = join(home, 'fuera');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'dato.txt'), 'x');
    new LinkService(defaultLinkDeps(() => undefined)).createDirLink(outside, join(account, 'ajeno'));

    service.deleteAccount(account);

    expect(existsSync(account)).toBe(false);
    expect(existsSync(join(outside, 'dato.txt'))).toBe(true);
  });

  it('deleteAccount_compartidaConvertidaEnDirRealConDatos_abortaYNoBorraNada', () => {
    const { service, account, commonFile } = accountWithSharedData();
    const projects = join(account, 'projects');
    // Se quita el enlace con el LinkService (nunca con rmSync: es justo lo que no esta medido aun).
    new LinkService(defaultLinkDeps(() => undefined)).removeDirLink(projects);
    mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, 'solo-aqui.jsonl'), '{}');

    expect(() => service.deleteAccount(account)).toThrow(projects);
    expect(existsSync(join(projects, 'solo-aqui.jsonl'))).toBe(true);
    expect(existsSync(join(account, 'sessions'))).toBe(true); // ni siquiera se desenlazo nada
    expect(existsSync(commonFile)).toBe(true);
  });
});
