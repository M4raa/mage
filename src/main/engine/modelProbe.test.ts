import { describe, expect, it, vi } from 'vitest';
import { probeModelCatalog, probeModelCatalogs, type ModelProbeDeps, type ProbeProcess } from './modelProbe';

// Respuesta REAL del CLI 2.1.283 al `initialize`, recortada a lo que importa (spike/init-spike.mjs).
const RESPONSE = JSON.stringify({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: 'mage-model-probe',
    response: {
      commands: [{ name: 'compact', description: 'Compacta' }],
      agents: [],
      models: [
        { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
        { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5' },
      ],
      current_permission_mode: 'default',
    },
  },
});

type FakeProbe = ProbeProcess & {
  emit: (chunk: string) => void;
  exit: () => void;
  readonly written: string[];
  readonly endInput: ReturnType<typeof vi.fn>;
  readonly killTree: ReturnType<typeof vi.fn>;
};

function fakeProbe(): FakeProbe {
  const outs: ((chunk: string) => void)[] = [];
  const exits: (() => void)[] = [];
  const written: string[] = [];
  return {
    written,
    onStdout: (listener) => outs.push(listener),
    onExit: (listener) => exits.push(listener),
    writeLine: (line) => written.push(line),
    endInput: vi.fn(),
    killTree: vi.fn(),
    emit: (chunk) => outs.forEach((listener) => listener(chunk)),
    exit: () => exits.forEach((listener) => listener()),
  };
}

function deps(child: FakeProbe, over: Partial<ModelProbeDeps> = {}): ModelProbeDeps {
  return { spawnProbe: () => child, timeoutMs: 50, exitGraceMs: 10, ...over };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('probeModelCatalog', () => {
  it('probeModelCatalog_respuestaDelInitialize_devuelveLosModelosYCierraLaEntrada', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'C:\\u\\.claude');
    child.emit(`{"type":"system","subtype":"hook_started"}\n${RESPONSE}\n`);

    expect(await result).toEqual([
      { id: 'default', label: 'Default (recommended)' },
      { id: 'opus', label: 'Opus 5.5' },
    ]);
    expect(JSON.parse(child.written[0] ?? '{}')).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } });
    expect(child.endInput).toHaveBeenCalledTimes(1);
  });

  it('probeModelCatalog_nuncaMandaUnMensajeDeUsuario', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'dir');
    child.emit(`${RESPONSE}\n`);
    await result;

    expect(child.written.every((line) => !line.includes('"type":"user"'))).toBe(true);
  });

  it('probeModelCatalog_respuestaPartidaEnDosTrozos_laReconstruye', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'dir');
    child.emit(RESPONSE.slice(0, 40));
    child.emit(`${RESPONSE.slice(40)}\n`);

    expect((await result)?.map((m) => m.id)).toEqual(['default', 'opus']);
  });

  it('probeModelCatalog_elCliNoSaleTrasCerrar_mataElArbol', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'dir');
    child.emit(`${RESPONSE}\n`);
    await result;
    await wait(30);

    expect(child.killTree).toHaveBeenCalledTimes(1);
  });

  it('probeModelCatalog_elCliSaleSolo_noLoMata', async () => {
    const child = fakeProbe();
    child.endInput.mockImplementation(() => child.exit());
    const result = probeModelCatalog(deps(child), 'dir');
    child.emit(`${RESPONSE}\n`);
    await result;
    await wait(30);

    expect(child.killTree).not.toHaveBeenCalled();
  });

  it('probeModelCatalog_plazoVencido_nullYMataElArbol', async () => {
    const child = fakeProbe();

    expect(await probeModelCatalog(deps(child, { timeoutMs: 5 }), 'dir')).toBeNull();
    await wait(30);
    expect(child.killTree).toHaveBeenCalledTimes(1);
  });

  it('probeModelCatalog_elCliSaleAntesDeResponder_null', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'dir');
    child.exit();

    expect(await result).toBeNull();
    expect(child.endInput).not.toHaveBeenCalled();
  });

  it('probeModelCatalog_respuestaDeError_null', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'dir');
    child.emit(`${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'mage-model-probe', error: 'no' } })}\n`);

    expect(await result).toBeNull();
  });

  it('probeModelCatalog_lineasQueNoSonJsonNiNuestras_lasIgnora', async () => {
    const child = fakeProbe();
    const result = probeModelCatalog(deps(child), 'dir');
    const otra = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'otra', response: { commands: [] } } });
    child.emit(`aviso suelto\n${otra}\n${RESPONSE}\n`);

    expect((await result)?.length).toBe(2);
  });
});

describe('probeModelCatalogs', () => {
  it('probeModelCatalogs_variasCuentas_enSerieYEnOrden', async () => {
    const started: string[] = [];
    const children: FakeProbe[] = [];
    const probeDeps: ModelProbeDeps = {
      spawnProbe: (dir) => {
        started.push(dir);
        const child = fakeProbe();
        children.push(child);
        // Contesta en la siguiente vuelta: si fueran en paralelo, las dos habrian arrancado ya.
        setTimeout(() => child.emit(`${RESPONSE}\n`), 1);
        return child;
      },
      timeoutMs: 100,
      exitGraceMs: 5,
    };
    const results: string[] = [];

    const run = probeModelCatalogs(probeDeps, ['a', 'b'], (dir, models) => results.push(`${dir}:${models?.length ?? 'null'}`));
    expect(started).toEqual(['a']);
    await run;

    expect(started).toEqual(['a', 'b']);
    expect(results).toEqual(['a:2', 'b:2']);
  });
});
