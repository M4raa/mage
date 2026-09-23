import { describe, expect, it, vi } from 'vitest';
import {
  killProcessTree,
  planKillProcessTree,
  type KillableChild,
  type KillTreeDeps,
  type KillerHandle,
} from './processTree';

// Hijo falso: registra las señales recibidas y puede simular un handle ya muerto (kill que lanza).
function fakeChild(pid: number | undefined, options: { throwOnKill?: boolean } = {}) {
  const signals: (NodeJS.Signals | undefined)[] = [];
  const child: KillableChild = {
    pid,
    kill: (signal?: NodeJS.Signals) => {
      signals.push(signal);
      if (options.throwOnKill === true) throw new Error('ESRCH: no such process');
      return true;
    },
  };
  return { child, signals };
}

// Captura los listeners de 'error' para poder dispararlos a mano (el fallo de taskkill es asincrono).
function fakeKiller() {
  const listeners: ((err: Error) => void)[] = [];
  const handle: KillerHandle = {
    on: (_event, listener) => {
      listeners.push(listener);
      return handle;
    },
  };
  return { handle, fail: (err = new Error('spawn taskkill ENOENT')) => listeners.forEach((l) => l(err)) };
}

function deps(overrides: Partial<KillTreeDeps> = {}): KillTreeDeps {
  return {
    platform: 'linux',
    spawnKiller: () => fakeKiller().handle,
    ...overrides,
  };
}

describe('planKillProcessTree', () => {
  it('plan_win32ConPidValido_usaTaskkillConArbolYForzado', () => {
    const plan = planKillProcessTree('win32', 4321);

    expect(plan).toEqual({
      strategy: 'tree',
      command: 'taskkill',
      args: ['/PID', '4321', '/T', '/F'],
      fallbackSignal: 'SIGTERM',
    });
  });

  it('plan_posixConPidValido_usaSenal', () => {
    const plan = planKillProcessTree('darwin', 99, 'SIGKILL');

    expect(plan).toEqual({ strategy: 'signal', signal: 'SIGKILL' });
  });

  it('plan_sinPid_noHaceNada', () => {
    expect(planKillProcessTree('win32', undefined).strategy).toBe('none');
    expect(planKillProcessTree('linux', null).strategy).toBe('none');
  });

  // pid 0 en POSIX significa "todo el grupo de procesos del llamante", que incluye a Mage: matarlo
  // seria un suicidio. Y un pid negativo tambien direcciona grupos. Ambos se rechazan.
  it('plan_pidCeroONegativo_seRechazaConElValorEnElMotivo', () => {
    const zero = planKillProcessTree('linux', 0);
    const negative = planKillProcessTree('linux', -1);

    expect(zero.strategy).toBe('none');
    expect(negative.strategy).toBe('none');
    if (zero.strategy !== 'none' || negative.strategy !== 'none') throw new Error('se esperaba none');
    expect(zero.reason).toContain('0');
    expect(negative.reason).toContain('-1');
  });

  it('plan_pidNoEntero_seRechaza', () => {
    expect(planKillProcessTree('win32', 12.5).strategy).toBe('none');
    expect(planKillProcessTree('win32', Number.NaN).strategy).toBe('none');
  });
});

describe('killProcessTree', () => {
  it('kill_win32_lanzaTaskkillYNoSenalizaAlHijo', () => {
    const { child, signals } = fakeChild(777);
    const spawnKiller = vi.fn(() => fakeKiller().handle);

    const outcome = killProcessTree(child, deps({ platform: 'win32', spawnKiller }));

    expect(outcome).toBe('tree');
    expect(spawnKiller).toHaveBeenCalledWith('taskkill', ['/PID', '777', '/T', '/F']);
    expect(signals).toEqual([]); // el arbol lo mata taskkill; no hace falta señal adicional
  });

  it('kill_posix_senalizaAlHijoSinLanzarNada', () => {
    const { child, signals } = fakeChild(777);
    const spawnKiller = vi.fn(() => fakeKiller().handle);

    const outcome = killProcessTree(child, deps({ platform: 'linux', spawnKiller }), 'SIGKILL');

    expect(outcome).toBe('signal');
    expect(spawnKiller).not.toHaveBeenCalled();
    expect(signals).toEqual(['SIGKILL']);
  });

  it('kill_taskkillFallaAsincrono_caeAlaSenalDirecta', () => {
    const { child, signals } = fakeChild(777);
    const killer = fakeKiller();

    killProcessTree(child, deps({ platform: 'win32', spawnKiller: () => killer.handle }));
    expect(signals).toEqual([]); // aun no ha fallado

    killer.fail();

    expect(signals).toEqual(['SIGTERM']);
  });

  it('kill_taskkillFallaSincrono_caeAlaSenalDirecta', () => {
    const { child, signals } = fakeChild(777);
    const spawnKiller = () => {
      throw new Error('taskkill no disponible');
    };

    const outcome = killProcessTree(child, deps({ platform: 'win32', spawnKiller }));

    expect(outcome).toBe('signal');
    expect(signals).toEqual(['SIGTERM']);
  });

  // Ruta de cierre: un throw aqui dejaria a medias el resto de la limpieza (gateway, ventanas, timers).
  it('kill_hijoYaMuerto_noPropagaElError', () => {
    const { child, signals } = fakeChild(777, { throwOnKill: true });

    expect(() => killProcessTree(child, deps({ platform: 'linux' }))).not.toThrow();
    expect(signals).toEqual(['SIGTERM']);
  });

  it('kill_sinHijo_noHaceNada', () => {
    const spawnKiller = vi.fn(() => fakeKiller().handle);

    expect(killProcessTree(null, deps({ platform: 'win32', spawnKiller }))).toBe('skipped');
    expect(killProcessTree(undefined, deps({ platform: 'win32', spawnKiller }))).toBe('skipped');
    expect(spawnKiller).not.toHaveBeenCalled();
  });

  it('kill_hijoSinPid_noLanzaTaskkillNiSenaliza', () => {
    const { child, signals } = fakeChild(undefined);
    const spawnKiller = vi.fn(() => fakeKiller().handle);

    const outcome = killProcessTree(child, deps({ platform: 'win32', spawnKiller }));

    expect(outcome).toBe('skipped');
    expect(spawnKiller).not.toHaveBeenCalled();
    expect(signals).toEqual([]);
  });
});
