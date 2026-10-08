import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CONSOLE_INPUT_SCRIPT, sendToConsole, type ConsoleHelperProcess } from './agyConsoleInput';

function fakeHelper() {
  const events = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const write = vi.fn();
  const helper = { stdin: { write, end: vi.fn() }, stdout, stderr, on: (event: string, listener: () => void) => events.on(event, listener) } as unknown as ConsoleHelperProcess;
  return { helper, write, stdout, stderr, exit: () => events.emit('exit'), error: () => events.emit('error') };
}

describe('sendToConsole', () => {
  it('sendToConsole_auxiliarDiceOk_resuelveYMandaElTextoPorStdinNoPorArgumentos', async () => {
    const fake = fakeHelper();
    const spawnHelper = vi.fn(() => fake.helper);
    const pending = sendToConsole({ spawnHelper, timeoutMs: 1000 }, 4242, '4/0AbCdEfGh');

    fake.stdout.emit('data', Buffer.from('ok 24\n'));
    fake.exit();

    await expect(pending).resolves.toBeUndefined();
    expect(spawnHelper).toHaveBeenCalledWith(CONSOLE_INPUT_SCRIPT, 4242);
    expect(fake.write).toHaveBeenCalledWith('4/0AbCdEfGh\n');
    expect(CONSOLE_INPUT_SCRIPT).not.toContain('4/0AbCdEfGh');
  });

  it('sendToConsole_windowsRechaza_lanzaConElPasoQueFallo', async () => {
    const fake = fakeHelper();
    const pending = sendToConsole({ spawnHelper: () => fake.helper, timeoutMs: 1000 }, 4242, 'codigo');

    fake.stdout.emit('data', 'AttachConsole fallo: 5\n');
    fake.exit();

    await expect(pending).rejects.toThrow('AttachConsole fallo: 5');
  });

  it('sendToConsole_noSePuedeLanzarPowershell_lanza', async () => {
    const fake = fakeHelper();
    const pending = sendToConsole({ spawnHelper: () => fake.helper, timeoutMs: 1000 }, 4242, 'codigo');

    fake.error();

    await expect(pending).rejects.toThrow('No se pudo lanzar PowerShell');
  });

  it('sendToConsole_sinRespuesta_lanzaPorTiempo', async () => {
    vi.useFakeTimers();
    const pending = sendToConsole({ spawnHelper: () => fakeHelper().helper, timeoutMs: 300 }, 4242, 'codigo');
    const assertion = expect(pending).rejects.toThrow('no respondio en 300 ms');

    await vi.advanceTimersByTimeAsync(400);

    await assertion;
    vi.useRealTimers();
  });

  it.each([[0], [-1], [1.5], [Number.NaN]])('sendToConsole_pidInvalido_%s_rechazaSinLanzarNada', async (pid) => {
    const spawnHelper = vi.fn();

    await expect(sendToConsole({ spawnHelper, timeoutMs: 100 }, pid, 'x')).rejects.toThrow('pid invalido');
    expect(spawnHelper).not.toHaveBeenCalled();
  });

  it.each([[''], ['dos\nlineas'], ['con\rretorno']])('sendToConsole_textoNoValido_%j_rechaza', async (text) => {
    await expect(sendToConsole({ spawnHelper: vi.fn(), timeoutMs: 100 }, 10, text)).rejects.toThrow('una sola linea');
  });
});
