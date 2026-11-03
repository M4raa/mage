import { describe, expect, it, vi } from 'vitest';
import { EXIT_OK, EXIT_REFUSED, runAccountAdd, runStop } from './commands.mjs';
import { createMessages } from './messages.mjs';

const messages = createMessages('es');
const ACTIVE = { outcome: 'refused', reason: 'active', sessions: [{ sessionId: 's1', conversationId: 'c1', provider: 'claude', state: 'running' }] };
const STOPPING = { outcome: 'stopping' };

function setup(responses) {
  const queue = [...responses];
  const rpc = { call: vi.fn(async () => queue.shift()) };
  const out = [];
  return { rpc, write: (text) => out.push(text), text: () => out.join('\n') };
}

describe('runStop', () => {
  it('runStop_stopping_0', async () => {
    const { rpc, write } = setup([STOPPING]);

    const code = await runStop({ rpc, force: false, confirm: null, write, messages });

    expect(code).toBe(EXIT_OK);
    expect(rpc.call).toHaveBeenCalledWith('host.stop', { force: false });
  });

  it('runStop_gui_4SinPreguntar', async () => {
    const { rpc, write, text } = setup([{ outcome: 'refused', reason: 'gui' }]);
    const confirm = vi.fn(async () => { throw new Error('no debe preguntar'); });

    const code = await runStop({ rpc, force: false, confirm, write, messages });

    expect(code).toBe(EXIT_REFUSED);
    expect(text()).toContain(messages.stopGui());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('runStop_activoSinTerminal_4ConLista', async () => {
    const { rpc, write, text } = setup([ACTIVE]);

    const code = await runStop({ rpc, force: false, confirm: null, write, messages });

    expect(code).toBe(EXIT_REFUSED);
    expect(text()).toContain('c1');
    expect(text()).toContain(messages.stopUseForce());
  });

  it('runStop_activoConfirmaSi_segundaLlamadaConForce_0', async () => {
    const { rpc, write } = setup([ACTIVE, STOPPING]);

    const code = await runStop({ rpc, force: false, confirm: async () => true, write, messages });

    expect(code).toBe(EXIT_OK);
    expect(rpc.call.mock.calls).toEqual([['host.stop', { force: false }], ['host.stop', { force: true }]]);
  });

  it('runStop_activoConfirmaNo_4', async () => {
    const { rpc, write } = setup([ACTIVE]);

    const code = await runStop({ rpc, force: false, confirm: async () => false, write, messages });

    expect(code).toBe(EXIT_REFUSED);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });

  it('runStop_activoConForce_noPregunta', async () => {
    const { rpc, write } = setup([ACTIVE]);
    const confirm = vi.fn(async () => true);

    const code = await runStop({ rpc, force: true, confirm, write, messages });

    expect(code).toBe(EXIT_REFUSED);
    expect(confirm).not.toHaveBeenCalled();
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });

  it('runStop_respuestaRara_lanza', async () => {
    const { rpc, write } = setup([{ outcome: 'raro' }]);

    await expect(runStop({ rpc, force: false, confirm: null, write, messages })).rejects.toThrow('Respuesta de host.stop no reconocida: {"outcome":"raro"}');
  });
});

describe('runAccountAdd', () => {
  const account = { provider: 'claude', name: 'K', billing: 'api' };

  it('runAccountAdd_mandaLaClaveYNoLaEscribe', async () => {
    const { rpc, write, text } = setup([{ account }]);

    const code = await runAccountAdd({ rpc, provider: 'claude', name: 'K', readKey: async () => '  sk-SECRETA \n', write, messages });

    expect(code).toBe(EXIT_OK);
    expect(rpc.call).toHaveBeenCalledWith('accounts.create', { provider: 'claude', name: 'K', apiKey: 'sk-SECRETA' });
    expect(text()).not.toContain('sk-SECRETA');
  });

  it('runAccountAdd_claveVacia_lanzaSinLlamar', async () => {
    const { rpc, write } = setup([]);

    await expect(runAccountAdd({ rpc, provider: 'claude', name: 'K', readKey: async () => ' \n', write, messages })).rejects.toThrow('No se recibió ninguna clave de API');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('runAccountAdd_errorDelHost_seRelanzaSinLaClave', async () => {
    const rpc = { call: vi.fn().mockRejectedValue(Object.assign(new Error('bóveda no disponible'), { code: -32603 })) };

    const error = await runAccountAdd({ rpc, provider: 'claude', name: 'K', readKey: async () => 'sk-SECRETA', write: () => undefined, messages }).catch((e) => e);

    expect(error.message).toBe('bóveda no disponible');
  });
});
