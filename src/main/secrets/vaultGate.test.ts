import { describe, expect, it, vi } from 'vitest';
import type { KeyringDiagnosis } from './linuxKeyring';
import type { SecretCipher } from './secretStore';
import { LINUX_KEYRING_GUIDE_URL, VAULT_ROUND_TRIP_TEXT, assessVault, linuxKeyringMessage, parseOsRelease, type VaultGateDeps } from './vaultGate';

const D1_PREFIX = 'No se puede crear ni usar esta cuenta de API: el llavero seguro de Linux está';
const D1_TAIL =
  'Las cuentas de suscripción siguen disponibles. Sigue las instrucciones de instalación, arranque y desbloqueo del llavero para tu distribución; después cierra y vuelve a abrir Mage para habilitar la bóveda.';

function cipher(overrides: Partial<SecretCipher> = {}): SecretCipher & { encryptString: ReturnType<typeof vi.fn> } {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: vi.fn((plain: string) => Buffer.from(`x${plain}`)),
    decryptString: (encrypted: Buffer) => encrypted.toString().slice(1),
    ...overrides,
  } as SecretCipher & { encryptString: ReturnType<typeof vi.fn> };
}

function deps(overrides: Partial<VaultGateDeps> = {}, diagnosis: KeyringDiagnosis = { state: 'unlocked', detail: null }): VaultGateDeps {
  return { platform: 'linux', cipher: cipher(), detectKeyring: vi.fn(async () => diagnosis), osRelease: () => ({ id: 'ubuntu', idLike: ['debian'] }), ...overrides };
}

describe('assessVault', () => {
  it('assess_linuxDesbloqueadoYRoundTrip_usable', async () => {
    const used = cipher();

    expect(await assessVault(deps({ cipher: used }))).toEqual({ usable: true });
    expect(used.encryptString).toHaveBeenCalledWith(VAULT_ROUND_TRIP_TEXT);
  });

  it.each([
    [{ state: 'absent', detail: null }, 'ausente (no hay ningún proveedor instalado)'],
    [{ state: 'not-running', detail: null }, 'sin arrancar'],
    [{ state: 'locked', detail: null }, 'bloqueado'],
    [{ state: 'no-collection', detail: null }, 'sin colección por defecto'],
    [{ state: 'error', detail: 'NoReply' }, 'inaccesible (NoReply)'],
  ] as const)('assess_linux_%o_mensajeD1SinTocarSafeStorage', async (diagnosis, state) => {
    const untouched = cipher();

    const status = await assessVault(deps({ cipher: untouched }, diagnosis));

    expect(status.usable).toBe(false);
    expect(status.usable === false && status.reason.startsWith(`${D1_PREFIX} ${state}. ${D1_TAIL}`)).toBe(true);
    expect(untouched.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(untouched.encryptString).not.toHaveBeenCalled();
  });

  it('assess_linuxDesbloqueadoPeroBackendBasicText_noUsableSinCifrar', async () => {
    const plain = cipher({ getSelectedStorageBackend: () => 'basic_text' });

    const status = await assessVault(deps({ cipher: plain }));

    expect(status.usable === false && status.reason).toContain('sin usar: Electron eligió el backend inseguro «basic_text»');
    expect(plain.encryptString).not.toHaveBeenCalled();
  });

  it('assess_linuxKwallet_noPreguntaAlSecretServiceYPruebaElCifrado', async () => {
    const detectKeyring = vi.fn(async (): Promise<KeyringDiagnosis> => ({ state: 'not-running', detail: null }));

    const status = await assessVault(deps({ cipher: cipher({ getSelectedStorageBackend: () => 'kwallet6' }), detectKeyring }));

    expect(status).toEqual({ usable: true });
    expect(detectKeyring).not.toHaveBeenCalled();
  });

  it('assess_linuxSinCifradoDisponible_D1', async () => {
    const status = await assessVault(deps({ cipher: cipher({ isEncryptionAvailable: () => false }) }));

    expect(status.usable === false && status.reason).toContain(`${D1_PREFIX} sin cifrado disponible.`);
  });

  it('assess_roundTripLanza_noUsableConElMotivo', async () => {
    const status = await assessVault(deps({ cipher: cipher({ decryptString: () => { throw new Error('Error while decrypting'); } }) }));

    expect(status.usable === false && status.reason).toContain('inaccesible: Error while decrypting');
  });

  it('assess_roundTripDevuelveOtroTexto_noUsable', async () => {
    const status = await assessVault(deps({ cipher: cipher({ decryptString: () => 'otro' }) }));

    expect(status.usable === false && status.reason).toContain('no devuelve el texto de prueba');
  });

  it('assess_windows_sinDiagnosticoDeLinuxYConRoundTrip', async () => {
    const detectKeyring = vi.fn();

    const status = await assessVault(deps({ platform: 'win32', cipher: cipher({ getSelectedStorageBackend: undefined }), detectKeyring }));

    expect(status).toEqual({ usable: true });
    expect(detectKeyring).not.toHaveBeenCalled();
  });

  it('assess_windowsSinCifrado_mensajeDelCifradoDelSistemaNoElDeLinux', async () => {
    const status = await assessVault(deps({ platform: 'win32', cipher: cipher({ isEncryptionAvailable: () => false }) }));

    expect(status.usable === false && status.reason).toBe('No se puede crear ni usar esta cuenta de API: el cifrado del sistema está sin cifrado disponible. Las cuentas de suscripción siguen disponibles.');
  });
});

describe('linuxKeyringMessage', () => {
  it('message_ubuntu_comandosDeAptYGuia', () => {
    const message = linuxKeyringMessage('bloqueado', { id: 'ubuntu', idLike: ['debian'] });

    expect(message).toContain('sudo apt install gnome-keyring libsecret-tools dbus-daemon');
    expect(message).toContain('gnome-keyring-daemon --unlock --components=secrets');
    expect(message).toContain(LINUX_KEYRING_GUIDE_URL);
  });

  it('message_arch_comandosDePacman', () => {
    expect(linuxKeyringMessage('ausente', { id: 'arch', idLike: [] })).toContain('sudo pacman -S --needed gnome-keyring libsecret dbus');
  });

  it('message_distribucionDesconocida_loDiceSinInventarComando', () => {
    const message = linuxKeyringMessage('ausente', { id: 'fedora', idLike: ['rhel'] });

    expect(message).toContain('Distribución no reconocida (ID=fedora)');
    expect(message).not.toMatch(/sudo (apt|pacman|dnf)/);
  });
});

describe('parseOsRelease', () => {
  it('parse_comillasEIdLike_losLee', () => {
    expect(parseOsRelease('NAME="Ubuntu"\nID=ubuntu\nID_LIKE="debian"\nVERSION_ID="26.04"\n')).toEqual({ id: 'ubuntu', idLike: ['debian'] });
  });

  it('parse_sinId_null', () => {
    expect(parseOsRelease('NAME=algo\n')).toBeNull();
  });

  it('parse_vacio_null', () => {
    expect(parseOsRelease('')).toBeNull();
  });
});
