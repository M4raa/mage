import { describe, expect, it, vi } from 'vitest';
import { HostErrorCode } from '../../src/main/host/hostProtocol.ts';
import { createMessages } from './messages.mjs';
import {
  CLIENT_TOKEN_MODE, NOT_PAIRED_CODE, PAIRING_REFUSED_CODE, TERMINAL_CLIENT_NAME,
  clientTokenPath, ensurePaired, isNotPairedError, readClientToken, saveClientToken,
} from './pairing.mjs';

const messages = createMessages('es');
const TOKEN = 'a'.repeat(64);

function link(access, call = vi.fn(async () => ({ clientId: 'c1', clientToken: TOKEN }))) {
  return { hello: { protocol: '1.8', access }, rpc: { call } };
}

describe('constantes', () => {
  it('codigos_igualesQueLosDelServidor', () => {
    expect(NOT_PAIRED_CODE).toBe(HostErrorCode.NotPaired);
    expect(PAIRING_REFUSED_CODE).toBe(HostErrorCode.PairingRefused);
  });
});

describe('clientTokenPath', () => {
  it('clientTokenPath_windowsYPosix_dentroDeRun', () => {
    expect(clientTokenPath('C:\\Users\\u\\AppData\\Roaming\\Mage', 'win32')).toBe('C:\\Users\\u\\AppData\\Roaming\\Mage\\run\\client-token');
    expect(clientTokenPath('/home/u/.config/Mage', 'linux')).toBe('/home/u/.config/Mage/run/client-token');
  });
});

describe('readClientToken', () => {
  it('readClientToken_valido_loDevuelveSinEspacios', () => {
    expect(readClientToken('/f', () => `${TOKEN}\n`)).toBe(TOKEN);
  });

  it('readClientToken_noExiste_undefined', () => {
    const missing = () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); };

    expect(readClientToken('/f', missing)).toBeUndefined();
  });

  it('readClientToken_formaInvalida_undefined', () => {
    expect(readClientToken('/f', () => '')).toBeUndefined();
    expect(readClientToken('/f', () => 'zz')).toBeUndefined();
    expect(readClientToken('/f', () => TOKEN.toUpperCase())).toBeUndefined();
  });

  it('readClientToken_otroError_lanza', () => {
    const denied = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };

    expect(() => readClientToken('/f', denied)).toThrow('EACCES');
  });
});

describe('saveClientToken', () => {
  it('saveClientToken_unix_escribeYFijaModo600', () => {
    const writeFile = vi.fn();
    const chmod = vi.fn();

    saveClientToken('/f', TOKEN, { writeFile, chmod, platform: 'linux' });

    expect(writeFile).toHaveBeenCalledWith('/f', TOKEN, { mode: CLIENT_TOKEN_MODE });
    expect(chmod).toHaveBeenCalledWith('/f', CLIENT_TOKEN_MODE);
  });

  it('saveClientToken_windows_sinChmod', () => {
    const chmod = vi.fn();

    saveClientToken('C:\\f', TOKEN, { writeFile: vi.fn(), chmod, platform: 'win32' });

    expect(chmod).not.toHaveBeenCalled();
  });
});

describe('ensurePaired', () => {
  it('ensurePaired_yaEmparejada_noPreguntaNiGuarda', async () => {
    const current = link('full');
    const saveToken = vi.fn();

    const result = await ensurePaired({ link: current, allowPairing: true, saveToken, say: vi.fn(), messages });

    expect(result).toBe(current);
    expect(current.rpc.call).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it('ensurePaired_hostAnteriorSinAccess_noPregunta', async () => {
    const current = { hello: { protocol: '1.7' }, rpc: { call: vi.fn() } };

    await ensurePaired({ link: current, allowPairing: true, saveToken: vi.fn(), say: vi.fn(), messages });

    expect(current.rpc.call).not.toHaveBeenCalled();
  });

  it('ensurePaired_soloLectura_pideEmparejarYGuardaElToken', async () => {
    const current = link('read');
    const saveToken = vi.fn();
    const say = vi.fn();

    await ensurePaired({ link: current, allowPairing: true, saveToken, say, messages });

    expect(current.rpc.call).toHaveBeenCalledWith('host.pair', { clientName: TERMINAL_CLIENT_NAME, clientKind: 'terminal' });
    expect(saveToken).toHaveBeenCalledWith(TOKEN);
    expect(say.mock.calls.map(([text]) => text)).toEqual([messages.pairingAsk(), messages.pairingDone()]);
    expect(JSON.stringify(say.mock.calls)).not.toContain(TOKEN);
  });

  it('ensurePaired_sinPermitirEmparejar_lanzaNotPairedSinPreguntar', async () => {
    const current = link('read');

    const promise = ensurePaired({ link: current, allowPairing: false, saveToken: vi.fn(), say: vi.fn(), messages });

    await expect(promise).rejects.toMatchObject({ code: NOT_PAIRED_CODE, message: messages.notPairedLocal() });
    expect(current.rpc.call).not.toHaveBeenCalled();
  });

  it('ensurePaired_rechazadoEnLaVentana_propagaElErrorSinGuardar', async () => {
    const refused = Object.assign(new Error('Se rechazó el emparejamiento en la ventana de Mage'), { code: PAIRING_REFUSED_CODE });
    const current = link('read', vi.fn(async () => { throw refused; }));
    const saveToken = vi.fn();

    await expect(ensurePaired({ link: current, allowPairing: true, saveToken, say: vi.fn(), messages })).rejects.toBe(refused);
    expect(saveToken).not.toHaveBeenCalled();
  });

  it('ensurePaired_tokenConFormaRara_lanzaSinGuardar', async () => {
    const current = link('read', vi.fn(async () => ({ clientId: 'c1', clientToken: 'corto' })));
    const saveToken = vi.fn();

    await expect(ensurePaired({ link: current, allowPairing: true, saveToken, say: vi.fn(), messages })).rejects.toThrow(/forma inesperada/);
    expect(saveToken).not.toHaveBeenCalled();
  });
});

describe('isNotPairedError', () => {
  it('isNotPairedError_codigos_soloLosDeEmparejar', () => {
    expect(isNotPairedError({ code: NOT_PAIRED_CODE })).toBe(true);
    expect(isNotPairedError({ code: PAIRING_REFUSED_CODE })).toBe(true);
    expect(isNotPairedError({ code: -32004 })).toBe(false);
    expect(isNotPairedError(null)).toBe(false);
  });
});
