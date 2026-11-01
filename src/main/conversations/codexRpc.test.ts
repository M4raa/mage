import { describe, expect, it, vi } from 'vitest';
import type { ProbeProcess } from '../engine/modelProbe';
import { codexThreadDelete, codexThreadTurnsList } from './codexRpc';
import { UserFacingError } from '@shared/i18n/localizedText';

// La petición siguiente a una respuesta sale en una microtarea: se cede el turno antes de emitir la respuesta siguiente.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Proceso falso: guarda lo escrito y deja disparar la salida del app-server a mano.
function fakeProcess(): { child: ProbeProcess; sent: Record<string, unknown>[]; emit: (line: string) => void; exit: () => void; killed: () => number } {
  const sent: Record<string, unknown>[] = [];
  let onStdout: (chunk: string) => void = () => undefined;
  let onExit: () => void = () => undefined;
  let kills = 0;
  const child: ProbeProcess = {
    onStdout: (listener) => { onStdout = listener; },
    onExit: (listener) => { onExit = listener; },
    writeLine: (line) => { sent.push(JSON.parse(line) as Record<string, unknown>); },
    endInput: () => undefined,
    killTree: () => { kills += 1; },
  };
  return { child, sent, emit: (line) => onStdout(`${line}\n`), exit: () => onExit(), killed: () => kills };
}

describe('codexThreadDelete', () => {
  it('codexThreadDelete_respuestaOk_inicializaBorraYCierraElProceso', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'C:\\home\\.codex-x', 'abc-123');

    fake.emit(JSON.stringify({ jsonrpc: '2.0', id: 'mage-rpc-init', result: {} }));
    await flush();
    fake.emit(JSON.stringify({ jsonrpc: '2.0', id: 'mage-rpc-call', result: {} }));

    await expect(pending).resolves.toBeUndefined();
    expect(fake.sent.map((m) => m.method)).toEqual(['initialize', 'initialized', 'thread/delete']);
    expect(fake.sent[2]).toMatchObject({ params: { threadId: 'abc-123' } });
    expect(fake.killed()).toBe(1);
  });

  it('codexThreadDelete_codexRechaza_lanzaConSuMotivo', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'h', 'abc');

    fake.emit(JSON.stringify({ id: 'mage-rpc-init', result: {} }));
    await flush();
    fake.emit(JSON.stringify({ id: 'mage-rpc-call', error: { message: 'no existe' } }));

    await expect(pending).rejects.toThrow('no existe');
  });

  it('codexThreadDelete_elProcesoMuereAntesDeResponder_lanza', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'h', 'abc');

    fake.exit();

    await expect(pending).rejects.toThrow('termino antes de responder');
  });

  it('codexThreadDelete_sinRespuesta_lanzaPorTiempo', async () => {
    vi.useFakeTimers();
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 500 }, 'h', 'abc');
    const assertion = expect(pending).rejects.toThrow('dentro de 500 ms');

    await vi.advanceTimersByTimeAsync(600);

    await assertion;
    vi.useRealTimers();
  });

  it('codexThreadDelete_idConSeparadores_rechazaSinLanzarNada', async () => {
    const spawn = vi.fn();

    await expect(codexThreadDelete({ spawnProbe: spawn, timeoutMs: 1000 }, 'h', '..\\x')).rejects.toThrow('Parametros invalidos');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('codexThreadDelete_lineasQueNoSonJson_seIgnoran', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'h', 'abc');

    fake.emit('aviso de arranque');
    fake.emit(JSON.stringify({ id: 'mage-rpc-init', result: {} }));
    await flush();
    fake.emit(JSON.stringify({ id: 'mage-rpc-call', result: {} }));

    await expect(pending).resolves.toBeUndefined();
  });
});

describe('codexThreadTurnsList', () => {
  const reply = (id: string, result: unknown): string => JSON.stringify({ id, result });
  const T1 = { id: 't1', items: [{ type: 'userMessage', id: 'u1' }] };

  function start(): { fake: ReturnType<typeof fakeProcess>; pending: Promise<unknown>; spawn: ReturnType<typeof vi.fn> } {
    const fake = fakeProcess();
    const spawn = vi.fn(() => fake.child);
    return { fake, spawn, pending: codexThreadTurnsList({ spawnProbe: spawn, timeoutMs: 1000 }, 'h', 'abc') };
  }

  it('codexThreadTurnsList_dosPaginas_juntaLosTurnosEnOrden', async () => {
    const { fake, pending } = start();

    fake.emit(reply('mage-rpc-init', {}));
    await flush();
    fake.emit(reply('mage-rpc-call', { data: [T1], nextCursor: 'c2', backwardsCursor: 'b' }));
    await flush();
    fake.emit(reply('mage-rpc-call-2', { data: [{ id: 't2', items: [] }], nextCursor: null }));

    await expect(pending).resolves.toEqual([T1, { id: 't2', items: [] }]);
    expect(fake.sent[2]).toMatchObject({ method: 'thread/turns/list', params: { threadId: 'abc', itemsView: 'full', sortDirection: 'asc' } });
    expect(fake.sent[2]?.params).not.toHaveProperty('cursor');
    expect((fake.sent[3]?.params as Record<string, unknown>).cursor).toBe('c2');
    expect(fake.killed()).toBe(1);
  });

  it('codexThreadTurnsList_ceroTurnos_reanudaYVuelveAPedir', async () => {
    const { fake, pending } = start();

    fake.emit(reply('mage-rpc-init', {}));
    await flush();
    fake.emit(reply('mage-rpc-call', { data: [], nextCursor: null }));
    await flush();
    fake.emit(reply('mage-rpc-call-2', {}));
    await flush();
    fake.emit(reply('mage-rpc-call-3', { data: [{ id: 't1', items: [] }], nextCursor: null }));

    await expect(pending).resolves.toEqual([{ id: 't1', items: [] }]);
    expect(fake.sent.map((m) => m.method)).toEqual(['initialize', 'initialized', 'thread/turns/list', 'thread/resume', 'thread/turns/list']);
    expect(fake.sent[3]?.params).toEqual({ threadId: 'abc', excludeTurns: true });
  });

  it('codexThreadTurnsList_ceroTurnosTrasReanudar_devuelveVacio', async () => {
    const { fake, pending } = start();

    fake.emit(reply('mage-rpc-init', {}));
    await flush();
    fake.emit(reply('mage-rpc-call', { data: [], nextCursor: null }));
    await flush();
    fake.emit(reply('mage-rpc-call-2', {}));
    await flush();
    fake.emit(reply('mage-rpc-call-3', { data: [], nextCursor: null }));

    await expect(pending).resolves.toEqual([]);
  });

  it('codexThreadTurnsList_camposDeMas_soloIdEItems', async () => {
    const { fake, pending } = start();

    fake.emit(reply('mage-rpc-init', {}));
    await flush();
    fake.emit(reply('mage-rpc-call', { data: [{ id: 't1', items: [], status: 'completed', startedAt: 1 }], nextCursor: null }));

    await expect(pending).resolves.toEqual([{ id: 't1', items: [] }]);
  });

  it('codexThreadTurnsList_respuestaSinData_lanza', async () => {
    const { fake, pending } = start();

    fake.emit(reply('mage-rpc-init', {}));
    await flush();
    fake.emit(reply('mage-rpc-call', { nextCursor: null }));

    await expect(pending).rejects.toThrow('thread/turns/list inesperada');
  });

  it('codexThreadTurnsList_codexRechaza_lanzaConSuMotivo', async () => {
    const { fake, pending } = start();

    fake.emit(reply('mage-rpc-init', {}));
    await flush();
    fake.emit(JSON.stringify({ id: 'mage-rpc-call', error: { message: 'hilo no encontrado' } }));

    await expect(pending).rejects.toThrow('Codex rechazo thread/turns/list: hilo no encontrado');
  });

  it('codexThreadTurnsList_idConSeparadores_rechazaSinLanzarNada', async () => {
    const spawn = vi.fn();

    await expect(codexThreadTurnsList({ spawnProbe: spawn, timeoutMs: 1000 }, 'h', '..\\x')).rejects.toThrow('Parametros invalidos');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('codexRpc — errores de cara al usuario', () => {
  it('codexThreadDelete_codexRechazaSinMotivo_lanzaConLaFraseSinMotivoComoParte', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'h', 'abc');

    fake.emit(JSON.stringify({ id: 'mage-rpc-init', result: {} }));
    await flush();
    fake.emit(JSON.stringify({ id: 'mage-rpc-call', error: {} }));

    const err: unknown = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserFacingError);
    expect((err as UserFacingError).localized).toEqual({
      key: 'errors.conversations.codexRpcRejected',
      values: { method: 'thread/delete' },
      parts: { detail: { key: 'errors.conversations.codexRpcNoReason' } },
    });
  });

  it('codexThreadDelete_codexRechazaConMotivo_elMotivoEsTextoAjeno', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'h', 'abc');

    fake.emit(JSON.stringify({ id: 'mage-rpc-init', result: {} }));
    await flush();
    fake.emit(JSON.stringify({ id: 'mage-rpc-call', error: { message: 'no existe' } }));

    const err = (await pending.catch((e: unknown) => e)) as UserFacingError;
    expect(err.localized.parts).toEqual({ detail: { key: 'events.detailOnly', values: { detail: 'no existe' } } });
  });

  it('codexThreadDelete_elProcesoMuereAntesDeResponder_lanzaLaClaveConElPropositoDeLaLlamada', async () => {
    const fake = fakeProcess();
    const pending = codexThreadDelete({ spawnProbe: () => fake.child, timeoutMs: 1000 }, 'h', 'abc');

    fake.exit();

    const err = (await pending.catch((e: unknown) => e)) as UserFacingError;
    expect(err.localized).toEqual({ key: 'errors.conversations.codexRpcExited', values: { purpose: 'thread/delete' } });
  });
});
