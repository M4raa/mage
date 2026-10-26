import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationLockRef } from '@shared/conversationLock';
import { ConversationLocks, HEARTBEAT_MS, ORPHAN_MS, type LockFs, type LockIdentity } from './conversationLocks';
import { conversationLocksDir, lockFileName, nodeLockFs, pidAliveCheck, resolveConversationLocksDir, TEST_LOCKS_DIR_ENV } from './conversationLockEnv';

const REF: ConversationLockRef = { provider: 'claude', accountDir: '/home/u/.claude', nativeId: 'c0ffee' };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// Dos (o más) «instancias» de Mage con su identidad, sobre la MISMA carpeta de locks en disco real, con un reloj y
// una tabla de pids vivos compartidos que el test controla.
function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-locks-'));
  roots.push(dir);
  const clock = { now: 1_000_000 };
  const alive = new Set<number>();
  let temp = 0;
  const instance = (profile: string, pid: number) => {
    alive.add(pid);
    const identity: LockIdentity = { instanceId: `${profile}-${pid}`, profile, profileHash: profile, pid };
    return new ConversationLocks({
      dir, identity, now: () => clock.now, isPidAlive: (candidate) => alive.has(candidate),
      fileNameOf: (ref) => lockFileName(ref, (p) => p), fs: nodeLockFs(fs, () => String((temp += 1))),
    });
  };
  const files = () => fs.readdirSync(dir).filter((name) => name.endsWith('.lock'));
  return { dir, clock, alive, instance, files };
}

describe('ConversationLocks', () => {
  it('acquire_dosInstanciasAbrenLaMismaConversacion_unaDuenaYLaOtraSoloLecturaConSuPerfil', () => {
    const { instance, files } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);

    const first = installed.acquire(REF, 'tab:1:a');
    const second = dev.acquire(REF, 'tab:1:b');

    expect(first).toEqual({ owner: true });
    expect(second).toEqual({ owner: false, profile: 'mage', orphan: false });
    expect(files()).toHaveLength(1);
  });

  it('acquire_muchasInstanciasALaVez_soloUnaEsDuena', () => {
    const { instance } = world();
    const instances = Array.from({ length: 8 }, (_, i) => instance(`perfil-${i}`, 300 + i));

    const owners = instances.map((locks, i) => locks.acquire(REF, `tab:1:${i}`)).filter((status) => status.owner);

    expect(owners).toHaveLength(1);
  });

  it('acquire_cuentasDistintasMismoIdNativo_noChocan', () => {
    const { instance } = world();
    const a = instance('a', 1);
    const b = instance('b', 2);

    expect(a.acquire(REF, 'tab:1:a').owner).toBe(true);
    expect(b.acquire({ ...REF, accountDir: '/home/u/.claude-otra' }, 'tab:1:b').owner).toBe(true);
  });

  it('acquire_mismaInstanciaDosPestanas_soloSeBorraAlSoltarLaUltima', () => {
    const { instance, files } = world();
    const locks = instance('mage', 101);
    locks.acquire(REF, 'tab:1:a');
    locks.acquire(REF, 'tab:1:b');

    locks.release(REF, 'tab:1:a');
    expect(files()).toHaveLength(1);
    locks.release(REF, 'tab:1:b');

    expect(files()).toEqual([]);
  });

  it('release_alCerrar_laOtraInstanciaPuedeTomarla', () => {
    const { instance } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);
    installed.acquire(REF, 'tab:1:a');

    installed.release(REF, 'tab:1:a');

    expect(dev.acquire(REF, 'tab:1:b')).toEqual({ owner: true });
  });

  it('releaseWhere_seCierraLaVentana_sueltaSusPestanasYNoLasDeOtra', () => {
    const { instance, files } = world();
    const locks = instance('mage', 101);
    locks.acquire(REF, 'tab:1:a');
    locks.acquire({ ...REF, nativeId: 'otra' }, 'tab:2:a');

    locks.releaseWhere((holder) => holder.startsWith('tab:1:'));

    expect(files()).toHaveLength(1);
    expect(locks.peek({ ...REF, nativeId: 'otra' })).toEqual({ owner: true });
  });

  it('releaseAll_alSalir_noQuedaNingunFichero', () => {
    const { instance, files } = world();
    const locks = instance('mage', 101);
    locks.acquire(REF, 'tab:1:a');
    locks.acquire({ ...REF, nativeId: 'otra' }, 'session:s1');

    locks.releaseAll();

    expect(files()).toEqual([]);
  });

  it('acquire_pidMuerto_huerfanoYTomarElControlLaDaALaOtra', () => {
    const { instance, alive } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);
    installed.acquire(REF, 'tab:1:a');
    alive.delete(101);

    expect(dev.acquire(REF, 'tab:1:b')).toEqual({ owner: false, profile: 'mage', orphan: true });
    expect(dev.takeOver(REF, 'tab:1:b')).toEqual({ owner: true });
    expect(installed.peek(REF)).toEqual({ owner: true }); // la caída no se entera hasta su latido...
    expect(installed.heartbeat()).toEqual({ lost: [REF], failed: [] }); // ...y entonces sabe que la perdió
    expect(installed.peek(REF)).toEqual({ owner: false, profile: 'mage-dev', orphan: false });
  });

  it('acquire_sinLatidoEn90s_huerfanoAunqueElPidViva', () => {
    const { instance, clock } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);
    installed.acquire(REF, 'tab:1:a');

    clock.now += ORPHAN_MS;
    expect(dev.acquire(REF, 'tab:1:b')).toMatchObject({ owner: false, orphan: false });
    clock.now += 1;

    expect(dev.acquire(REF, 'tab:1:b')).toMatchObject({ owner: false, orphan: true });
  });

  it('heartbeat_cada30s_laMantieneViva', () => {
    const { instance, clock } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);
    installed.acquire(REF, 'tab:1:a');

    for (let i = 0; i < 5; i++) {
      clock.now += HEARTBEAT_MS;
      expect(installed.heartbeat()).toEqual({ lost: [], failed: [] });
    }

    expect(dev.acquire(REF, 'tab:1:b')).toMatchObject({ owner: false, orphan: false });
  });

  it('takeOver_noHuerfano_sigueEnSoloLectura', () => {
    const { instance } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);
    installed.acquire(REF, 'tab:1:a');

    expect(dev.takeOver(REF, 'tab:1:b')).toEqual({ owner: false, profile: 'mage', orphan: false });
    expect(installed.peek(REF)).toEqual({ owner: true });
  });

  it('release_trasPerderla_noBorraElFicheroDeLaOtra', () => {
    const { instance, alive, files } = world();
    const installed = instance('mage', 101);
    const dev = instance('mage-dev', 202);
    installed.acquire(REF, 'tab:1:a');
    alive.delete(101);
    dev.takeOver(REF, 'tab:1:b');

    installed.release(REF, 'tab:1:a');

    expect(files()).toHaveLength(1);
    expect(dev.peek(REF)).toEqual({ owner: true });
  });

  it('acquire_ficheroIlegibleReciente_noEsHuerfano_yViejoSi', () => {
    const { dir, instance, clock } = world();
    const dev = instance('mage-dev', 202);
    const file = path.join(dir, lockFileName(REF, (p) => p));
    fs.writeFileSync(file, '{"instanceId":');
    fs.utimesSync(file, clock.now / 1000, clock.now / 1000);

    expect(dev.acquire(REF, 'tab:1:b')).toEqual({ owner: false, profile: 'perfil desconocido', orphan: false });
    clock.now += ORPHAN_MS + 1;
    expect(dev.acquire(REF, 'tab:1:b')).toMatchObject({ orphan: true });
  });

  it('peek_nadieLaTiene_null', () => {
    expect(world().instance('mage', 1).peek(REF)).toBeNull();
  });
});

describe('resolveConversationLocksDir (H3 de la devolución 17)', () => {
  const root = path.resolve('/datos/mage');
  const harness = path.resolve('/tmp/mage-verify-locks-1');

  it('locksDir_sinVariable_laRaizCompartida', () => {
    expect(resolveConversationLocksDir({ localMageRoot: root, packaged: false, env: {} })).toBe(conversationLocksDir(root));
  });

  it('locksDir_variableDelHarnessSinEmpaquetar_esaCarpeta', () => {
    expect(resolveConversationLocksDir({ localMageRoot: root, packaged: false, env: { [TEST_LOCKS_DIR_ENV]: harness } })).toBe(harness);
  });

  it('locksDir_appEmpaquetada_ignoraLaVariable', () => {
    expect(resolveConversationLocksDir({ localMageRoot: root, packaged: true, env: { [TEST_LOCKS_DIR_ENV]: harness } })).toBe(conversationLocksDir(root));
  });

  it('locksDir_variableVacia_laRaizCompartida', () => {
    expect(resolveConversationLocksDir({ localMageRoot: root, packaged: false, env: { [TEST_LOCKS_DIR_ENV]: '' } })).toBe(conversationLocksDir(root));
  });

  it('locksDir_variableRelativa_lanzaConElValor', () => {
    expect(() => resolveConversationLocksDir({ localMageRoot: root, packaged: false, env: { [TEST_LOCKS_DIR_ENV]: 'locks' } })).toThrow('"locks"');
  });
});

describe('lockFileName', () => {
  it('lockFileName_perfilPrivado_mismoQueSuCuenta', () => {
    const canonicalize = (p: string) => p;

    expect(lockFileName({ ...REF, accountDir: path.join('/home/u/.claude', 'mage-private') }, canonicalize)).toBe(lockFileName({ ...REF, accountDir: path.join('/home/u/.claude') }, canonicalize));
  });

  it('lockFileName_canonizaLaCuenta', () => {
    expect(lockFileName({ ...REF, accountDir: 'C:/USERS/U/.claude' }, (p) => p.toLowerCase())).toBe(lockFileName({ ...REF, accountDir: 'c:/users/u/.claude' }, (p) => p.toLowerCase()));
  });

  it('lockFileName_runtimeSinCuenta_noCanoniza', () => {
    const canonicalize = (p: string): string => { throw new Error(`no debía canonizar ${p}`); };

    expect(lockFileName({ provider: 'custom:ollama', accountDir: '', nativeId: 'r1' }, canonicalize)).toMatch(/^[0-9a-f]{32}\.lock$/);
  });

  it('lockFileName_otroProveedor_otroFichero', () => {
    expect(lockFileName({ ...REF, provider: 'codex' }, (p) => p)).not.toBe(lockFileName(REF, (p) => p));
  });
});

describe('ConversationLocks.heartbeat con fallos de E/S (H1 de la devolución 17)', () => {
  const OTHER: ConversationLockRef = { ...REF, nativeId: 'otra' };

  it('heartbeat_unaConversacionFalla_lasDemasSeRenuevanNadaEscapaYSigueSiendoDeEstaInstancia', () => {
    const { dir, clock, alive, instance } = world();
    alive.add(101);
    const eperm = Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    const failingPath = path.join(dir, lockFileName(REF, (p) => p));
    const realFs = nodeLockFs(fs, () => String(Math.random()).slice(2), () => undefined);
    const flakyFs: LockFs = { ...realFs, replace: (target, content) => { if (target === failingPath) throw eperm; realFs.replace(target, content); } };
    const locks = new ConversationLocks({
      dir, identity: { instanceId: 'mage-101', profile: 'mage', profileHash: 'mage', pid: 101 }, now: () => clock.now,
      isPidAlive: (pid) => alive.has(pid), fileNameOf: (ref) => lockFileName(ref, (p) => p), fs: flakyFs,
    });
    locks.acquire(REF, 'tab:1:a');
    locks.acquire(OTHER, 'tab:1:b');
    clock.now += HEARTBEAT_MS;

    const result = locks.heartbeat();

    expect(result.lost).toEqual([]);
    expect(result.failed).toEqual([{ ref: REF, error: eperm }]);
    expect(locks.peek(REF)).toEqual({ owner: true });
    const renewed = JSON.parse(fs.readFileSync(path.join(dir, lockFileName(OTHER, (p) => p)), 'utf8')) as { heartbeatAt: number };
    expect(renewed.heartbeatAt).toBe(clock.now);
    expect(instance('mage-dev', 202).acquire(OTHER, 'tab:9:z')).toMatchObject({ owner: false, orphan: false });
  });
});

describe('nodeLockFs.replace (H1 de la devolución 17)', () => {
  const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

  function flakyRenameFs(failures: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-locks-replace-'));
    roots.push(dir);
    let calls = 0;
    const renameSync = (from: string, to: string): void => {
      calls += 1;
      if (calls <= failures) throw eperm();
      fs.renameSync(from, to);
    };
    const lockFs = nodeLockFs({ ...fs, renameSync }, () => String(calls), () => undefined);
    return { dir, lockFs, calls: () => calls };
  }

  it('replace_renameEPERMUnaYDosVeces_reintentaYSustituye', () => {
    for (const failures of [1, 2]) {
      const { dir, lockFs, calls } = flakyRenameFs(failures);
      const target = path.join(dir, 'a.lock');
      fs.writeFileSync(target, 'viejo');

      lockFs.replace(target, 'nuevo');

      expect(fs.readFileSync(target, 'utf8')).toBe('nuevo');
      expect(calls()).toBe(failures + 1);
      expect(fs.readdirSync(dir)).toEqual(['a.lock']);
    }
  });

  it('replace_renameEPERMSiempre_lanzaConLaRutaYNoDejaElTemporal', () => {
    const { dir, lockFs } = flakyRenameFs(Number.POSITIVE_INFINITY);
    const target = path.join(dir, 'a.lock');
    fs.writeFileSync(target, 'viejo');

    expect(() => lockFs.replace(target, 'nuevo')).toThrow(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('viejo');
    expect(fs.readdirSync(dir)).toEqual(['a.lock']);
  });
});

describe('pidAliveCheck', () => {
  const failing = (code: string) => () => { throw Object.assign(new Error(code), { code }); };

  it('pidAlive_existe_true', () => {
    expect(pidAliveCheck(() => undefined)(1)).toBe(true);
  });

  it('pidAlive_ESRCH_false_EPERM_true', () => {
    expect(pidAliveCheck(failing('ESRCH'))(1)).toBe(false);
    expect(pidAliveCheck(failing('EPERM'))(1)).toBe(true);
  });

  it('pidAlive_otroError_sePropaga', () => {
    expect(() => pidAliveCheck(failing('EINVAL'))(1)).toThrow('EINVAL');
  });

  it('pidAlive_procesoRealDeEsteTest_true', () => {
    expect(pidAliveCheck((pid, signal) => { process.kill(pid, signal); })(process.pid)).toBe(true);
  });
});
