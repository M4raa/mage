import { describe, expect, it, vi } from 'vitest';
import { createDbusSend, type ExecFileFn } from './dbusSend';

describe('createDbusSend', () => {
  it('call_construyeLaLlamadaConElPlazoEnLosDosSitios', async () => {
    const execFile = vi.fn<ExecFileFn>((_file, _args, _options, callback) => callback(null, '   boolean true\n', ''));

    const reply = await createDbusSend(execFile)('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', ['string:org.freedesktop.secrets'], 500);

    expect(reply).toBe('   boolean true\n');
    expect(execFile.mock.calls[0]?.[0]).toBe('dbus-send');
    expect(execFile.mock.calls[0]?.[1]).toEqual([
      '--session', '--print-reply', '--reply-timeout=500', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', 'string:org.freedesktop.secrets',
    ]);
    expect(execFile.mock.calls[0]?.[2]).toMatchObject({ timeout: 500 });
  });

  it('call_errorConStderr_rechazaConElMetodoYElMotivo', async () => {
    const execFile = vi.fn<ExecFileFn>((_file, _args, _options, callback) => callback(new Error('Command failed'), '', 'Error org.freedesktop.DBus.Error.NoReply: timeout\n'));

    await expect(createDbusSend(execFile)('d', '/p', 'Metodo', [], 500)).rejects.toThrow('Metodo: Error org.freedesktop.DBus.Error.NoReply: timeout');
  });

  it('call_sinDbusSend_rechazaConElErrorDelSistema', async () => {
    const execFile = vi.fn<ExecFileFn>((_file, _args, _options, callback) => callback(new Error('spawn dbus-send ENOENT'), '', ''));

    await expect(createDbusSend(execFile)('d', '/p', 'Metodo', [], 500)).rejects.toThrow('Metodo: spawn dbus-send ENOENT');
  });
});
