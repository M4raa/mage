import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeProcess } from '../engine/modelProbe';
import { authenticateMcp, type McpAuthDeps } from './mcpAuthFlow';

// Proceso falso: contesta a cada control_request con lo que diga `answer` (null = no contesta).
function fakeProcess(answer: (subtype: string, count: number, request: Record<string, unknown>) => unknown | null) {
  let stdout: (chunk: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  const counts = new Map<string, number>();
  const sent: Record<string, unknown>[] = [];
  const proc: ProbeProcess & { readonly sent: typeof sent; readonly die: () => void } = {
    onStdout: (listener) => {
      stdout = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
    writeLine: (line) => {
      const { request_id, request } = JSON.parse(line) as { request_id: string; request: Record<string, unknown> & { subtype: string } };
      sent.push(request);
      const count = (counts.get(request.subtype) ?? 0) + 1;
      counts.set(request.subtype, count);
      const body = answer(request.subtype, count, request);
      if (body === null) return;
      queueMicrotask(() => stdout(`${JSON.stringify({ type: 'control_response', response: { request_id, ...(body as object) } })}\n`));
    },
    endInput: () => exit(),
    killTree: () => undefined,
    sent,
    die: () => exit(),
  };
  return proc;
}

const ok = (response: unknown = {}) => ({ subtype: 'success', response });
const status = (value: string, extra: object = {}) => ok({ mcpServers: [{ name: 'plugin:figma:figma', status: value, scope: 'dynamic', config: { url: 'x' }, ...extra }] });
const AUTH_OK = ok({ authUrl: 'https://www.figma.com/oauth/mcp?state=s', requiresUserAction: true, callbackExpected: true, callbackPort: 4000 });

function deps(proc: ProbeProcess, openUrl: McpAuthDeps['openUrl'] = vi.fn(async () => undefined)): McpAuthDeps {
  return { spawnProbe: () => proc, openUrl, timeoutMs: 300_000, pollMs: 2_000, exitGraceMs: 3_000 };
}

describe('authenticateMcp', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('authenticateMcp_callbackYConecta_abreLaUrlYDevuelveConnected', async () => {
    const proc = fakeProcess((subtype, n) => {
      if (subtype === 'initialize') return ok();
      if (subtype === 'mcp_authenticate') return AUTH_OK;
      return status(n < 3 ? 'needs-auth' : 'connected');
    });
    const openUrl = vi.fn(async () => undefined);

    const pending = authenticateMcp(deps(proc, openUrl), '/c', 'plugin:figma:figma');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(openUrl).toHaveBeenCalledWith('https://www.figma.com/oauth/mcp?state=s');
    expect(proc.sent[1]).toEqual({ subtype: 'mcp_authenticate', serverName: 'plugin:figma:figma' });
    expect(result).toEqual({ kind: 'connected', statuses: [{ name: 'plugin:figma:figma', status: 'connected', scope: 'dynamic' }] });
    expect(JSON.stringify(result)).not.toContain('url');
  });

  it('authenticateMcp_sinCallback_devuelveTimeoutConElUltimoEstado', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok() : subtype === 'mcp_authenticate' ? AUTH_OK : status('needs-auth')));

    const pending = authenticateMcp(deps(proc), '/c', 'plugin:figma:figma');
    await vi.advanceTimersByTimeAsync(300_000);

    expect(await pending).toEqual({ kind: 'timeout', statuses: [{ name: 'plugin:figma:figma', status: 'needs-auth', scope: 'dynamic' }] });
  });

  it('authenticateMcp_conectorSinCallback_devuelveOpenedSinPreguntarEstado', async () => {
    const proc = fakeProcess((subtype) =>
      subtype === 'initialize' ? ok() : ok({ authUrl: 'https://claude.ai/x', requiresUserAction: true, callbackExpected: false }),
    );

    const result = await authenticateMcp(deps(proc), '/c', 'claude.ai Gmail');

    expect(result).toEqual({ kind: 'opened', statuses: null });
    expect(proc.sent.map((r) => r.subtype)).toEqual(['initialize', 'mcp_authenticate']);
  });

  it('authenticateMcp_cliRechaza_devuelveSuMensaje', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok() : { subtype: 'error', error: 'Server not found: nope' }));

    expect(await authenticateMcp(deps(proc), '/c', 'nope')).toEqual({ kind: 'error', message: 'Server not found: nope' });
  });

  it('authenticateMcp_servidorFalla_devuelveErrorConElDetalle', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok() : subtype === 'mcp_authenticate' ? AUTH_OK : status('failed', { error: 'HTTP 500' })));

    const result = await authenticateMcp(deps(proc), '/c', 'plugin:figma:figma');

    expect(result).toEqual({ kind: 'error', message: 'El servidor plugin:figma:figma no conectó tras autenticar: HTTP 500' });
  });

  it('authenticateMcp_navegadorNoAbre_devuelveError', async () => {
    const proc = fakeProcess((subtype) => (subtype === 'initialize' ? ok() : AUTH_OK));
    const openUrl = vi.fn(async () => {
      throw new Error('Esquema no permitido');
    });

    expect(await authenticateMcp(deps(proc, openUrl), '/c', 'plugin:figma:figma')).toEqual({ kind: 'error', message: 'No se pudo abrir el navegador: Esquema no permitido' });
  });

  it('authenticateMcp_cliMuere_devuelveError', async () => {
    const proc = fakeProcess(() => null);

    const pending = authenticateMcp(deps(proc), '/c', 'plugin:figma:figma');
    proc.die();

    expect(await pending).toEqual({ kind: 'error', message: 'El CLI terminó antes de completar la autenticación.' });
  });

  it('authenticateMcp_nombreVacio_lanza', async () => {
    await expect(authenticateMcp(deps(fakeProcess(() => null)), '/c', ' ')).rejects.toThrow(/vacio/);
  });
});
