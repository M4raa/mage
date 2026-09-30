import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeProcess } from '../engine/modelProbe';
import { probeMcpStatus, probeMcpStatuses } from './mcpStatusProbe';

// Proceso falso que contesta a cada control_request con lo que diga `answer`.
function fakeProcess(answer: (subtype: string, count: number) => unknown | null): ProbeProcess & { readonly killed: () => boolean; readonly ended: () => boolean } {
  let stdout: (chunk: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  const counts = new Map<string, number>();
  let killed = false;
  let ended = false;
  return {
    onStdout: (listener) => {
      stdout = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
    writeLine: (line) => {
      const { request_id, request } = JSON.parse(line) as { request_id: string; request: { subtype: string } };
      const count = (counts.get(request.subtype) ?? 0) + 1;
      counts.set(request.subtype, count);
      const body = answer(request.subtype, count);
      if (body === null) return;
      queueMicrotask(() => stdout(`${JSON.stringify({ type: 'control_response', response: { request_id, ...(body as object) } })}\n`));
    },
    endInput: () => {
      ended = true;
      exit();
    },
    killTree: () => {
      killed = true;
    },
    killed: () => killed,
    ended: () => ended,
  };
}

const ok = (response: unknown) => ({ subtype: 'success', response });
const status = (servers: unknown[]) => ok({ mcpServers: servers });
const deps = (proc: ProbeProcess) => ({ spawnProbe: () => proc, timeoutMs: 20_000, pollMs: 1_000, exitGraceMs: 3_000 });

describe('probeMcpStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('probeMcpStatus_sinPendientes_devuelveNombreEstadoYScopeSinConfig', async () => {
    const proc = fakeProcess((subtype) =>
      subtype === 'initialize' ? ok({}) : status([{ name: 'a', status: 'connected', scope: 'user', config: { env: { T: 'secreto' } } }]),
    );

    const result = await probeMcpStatus(deps(proc), '/c');

    expect(result).toEqual([{ name: 'a', status: 'connected', scope: 'user' }]);
    expect(JSON.stringify(result)).not.toContain('secreto');
    expect(proc.ended()).toBe(true);
  });

  it('probeMcpStatus_conPendientes_vuelveAPreguntarHastaQueTerminen', async () => {
    const proc = fakeProcess((subtype, n) => {
      if (subtype === 'initialize') return ok({});
      return status([{ name: 'a', status: n < 3 ? 'pending' : 'failed' }]);
    });

    const pending = probeMcpStatus(deps(proc), '/c');
    await vi.advanceTimersByTimeAsync(2_500);

    expect(await pending).toEqual([{ name: 'a', status: 'failed', scope: null }]);
  });

  it('probeMcpStatus_venceElPlazoConPendientes_devuelveLoUltimo', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok({}) : status([{ name: 'a', status: 'pending' }])));

    const pending = probeMcpStatus(deps(proc), '/c');
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await pending).toEqual([{ name: 'a', status: 'pending', scope: null }]);
  });

  it('probeMcpStatus_sinRespuesta_nullYMataElArbolTrasLaGracia', async () => {
    const proc = fakeProcess(() => null);
    const noExit = { ...proc, endInput: () => undefined };

    const pending = probeMcpStatus(deps(noExit), '/c');
    await vi.advanceTimersByTimeAsync(23_000);

    expect(await pending).toBeNull();
    expect(proc.killed()).toBe(true);
  });

  it('probeMcpStatus_respuestaDeError_null', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok({}) : { subtype: 'error', error: 'x' }));

    expect(await probeMcpStatus(deps(proc), '/c')).toBeNull();
  });

  it('probeMcpStatus_entradasConFormaRara_seDescartan', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok({}) : status([{ name: 1 }, null, { name: 'b', status: 'connected' }])));

    expect(await probeMcpStatus(deps(proc), '/c')).toEqual([{ name: 'b', status: 'connected', scope: null }]);
  });
});

describe('probeMcpStatuses', () => {
  it('probeMcpStatuses_cuentaQueNoContesta_noAparece', async () => {
    const good = fakeProcess((subtype) => (subtype === 'initialize' ? ok({}) : status([{ name: 'a', status: 'connected' }])));
    const bad = fakeProcess((subtype) => (subtype === 'initialize' ? { subtype: 'error', error: 'x' } : null));
    const spawnProbe = (dir: string): ProbeProcess => (dir === '/good' ? good : bad);

    const result = await probeMcpStatuses({ spawnProbe, timeoutMs: 1_000, pollMs: 100, exitGraceMs: 100 }, ['/good', '/bad']);

    expect(result).toEqual({ '/good': [{ name: 'a', status: 'connected', scope: null }] });
  });
});
