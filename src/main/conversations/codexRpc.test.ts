import { describe, expect, it, vi } from 'vitest';
import type { ProbeProcess } from '../engine/modelProbe';
import { codexThreadDelete } from './codexRpc';

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
    fake.emit(JSON.stringify({ id: 'mage-rpc-call', result: {} }));

    await expect(pending).resolves.toBeUndefined();
  });
});
