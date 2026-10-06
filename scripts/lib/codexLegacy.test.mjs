import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { instructionLocation, probeAppServer } from '../../spike/codex-legacy-verification.mjs';

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = { resume: vi.fn() };
  child.stdin = Object.assign(new EventEmitter(), { write: (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return true;
    const result = request.method === 'thread/start' ? { thread: { id: 'thread-artificial' } } : request.method === 'turn/start' ? { turn: { id: 'turn-artificial' } } : {};
    child.stdout.emit('data', JSON.stringify({ id: request.id, result }) + '\n');
    return true;
  } });
  child.kill = vi.fn(() => { child.exitCode = 0; child.emit('close'); });
  return child;
}

describe('medición histórica aislada', () => {
  it('probeAppServer_transporteInyectado_mideYCierraSinProcesoReal', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const child = fakeProcess();
    const spawn = vi.fn(() => child);
    const context = { bin: 'fake', home: 'owned-home', workspace: 'owned-workspace', deps: { spawn, baseEnv: {}, scrubAgentEnv: () => ({}) } };
    try {
      const done = probeAppServer(context);
      await vi.runAllTimersAsync();
      await done;

      expect(spawn).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('Perfil real de Codex: no consultado.');
    } finally { log.mockRestore(); vi.useRealTimers(); }
  });
  it('instructionLocation_inputSinContenido_noInventaMarca', () => {
    const result = instructionLocation({ input: [{ type: 'test' }] }, 'ARTIFICIAL');

    expect(result).toEqual({ base: false, roles: [] });
  });
  it('instructionLocation_marcaArtificial_proyectaSoloLaUbicacion', () => {
    const result = instructionLocation({ instructions: 'ARTIFICIAL', input: [{ role: 'developer', content: 'ARTIFICIAL' }] }, 'ARTIFICIAL');

    expect(result).toEqual({ base: true, roles: ['developer'] });
  });
});
