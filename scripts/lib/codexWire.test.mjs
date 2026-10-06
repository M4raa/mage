import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { rpcSession } from '../../spike/codex-verification.mjs';
import { recordedSpawn } from '../../spike/codex-real-verification.mjs';
import { jsonLines, parseExternalJson, RPC_MESSAGE, THREAD_MARKER, MODELS_RESULT, validatedResult } from '../../spike/codex-wire.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = vi.fn();
  child.stderr = { resume: vi.fn() };
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  child.kill = vi.fn();
  return child;
}

describe('rpcSession', () => {
  it('rpcSession_jsonNulo_rechazaSinLanzarDesdeElListener', async () => {
    const child = fakeChild();
    const deps = { spawn: () => child, scrubAgentEnv: () => ({}), baseEnv: {} };
    const session = rpcSession({ bin: 'fake', home: 'fake', workspace: 'fake', deps });
    const result = session.request('initialize').catch((error) => error.message);

    expect(() => child.stdout.emit('data', 'null\n')).not.toThrow();

    expect(await result).toMatch(/NDJSON/);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('recordedSpawn_jsonInvalido_detieneSinExponerContenido', () => {
    const child = fakeChild();
    const raw = [];
    recordedSpawn(raw, vi.fn(), () => child)('fake', [], {});

    expect(() => child.stdout.emit('data', '{"synthetic":"do-not-log"\n')).not.toThrow();

    expect(raw).toEqual([]);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it.each(['null', '[]', '{"id":1,"error":{"code":"invalid"}}', '{invalid'])('jsonLines_formaInvalida_%s_rechazaConCategoriaSegura', (line) => {
    const fail = vi.fn();
    const receive = vi.fn();
    const read = jsonLines({ schema: RPC_MESSAGE, receive, fail });

    read(`${line}\n`);
    read('{"id":1,"result":{}}\n');

    expect(receive).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(fail.mock.calls[0][0].message).toBe(`NDJSON inválido (longitud ${line.length})`);
  });

  it('jsonLines_chunksPartidos_conservaElCodigoNegativo', () => {
    const receive = vi.fn();
    const fail = vi.fn();
    const read = jsonLines({ schema: RPC_MESSAGE, receive, fail });

    read('{"id":1,"error":');
    read('{"code":-32600}}\n');

    expect(receive).toHaveBeenCalledWith({ id: 1, error: { code: -32600 } });
    expect(fail).not.toHaveBeenCalled();
  });

  it('parseExternalJson_marcadorSinId_rechazaSinMostrarElContenido', () => {
    const text = '{"threadId":null,"synthetic":"do-not-log"}';

    const act = () => parseExternalJson(text, THREAD_MARKER, 'Marcador');

    expect(act).toThrow(`Marcador: forma inesperada (longitud ${text.length})`);
  });

  it('validatedResult_modelosSinArray_rechazaAntesDeMapear', () => {
    const act = () => validatedResult({ result: { data: null } }, MODELS_RESULT, 'model/list');

    expect(act).toThrow('model/list: resultado con forma inesperada');
  });
});
