import { describe, expect, it, vi } from 'vitest';
import { foreignText, localized, localizedWithParts } from '@shared/i18n/localizedText';
import { esText } from '@testing/localizedText';
import type { KeyringDiagnosis } from './linuxKeyring';
import type { SecretCipher } from './secretStore';
import { LINUX_KEYRING_GUIDE_URL, VAULT_ROUND_TRIP_TEXT, assessVault, linuxKeyringMessage, parseOsRelease, type VaultGateDeps } from './vaultGate';

const D1_PREFIX = 'No se puede crear ni usar esta cuenta de API: el llavero seguro de Linux está';
const D1_TAIL =
  'Las cuentas de suscripción siguen disponibles. Sigue las instrucciones de instalación, arranque y desbloqueo del llavero para tu distribución; después cierra y vuelve a abrir Mage para habilitar la bóveda.';
// Literal del 0.1.2: el bloque de desbloqueo que va tras la línea de instalación en todas las distribuciones.
const UNLOCK_012 =
  "Arranque y desbloqueo sin escritorio: dbus-run-session -- bash; después read -r -s keyring_password; printf '%s' \"$keyring_password\" | gnome-keyring-daemon --unlock --components=secrets; unset keyring_password; y arranca Mage desde esa shell.";

// El mensaje completo que daba el 0.1.2 (copiado de `linuxKeyringMessage` antes de convertirla), para un estado y una línea de instalación.
function message012(state: string, install: string): string {
  return [`${D1_PREFIX} ${state}. ${D1_TAIL}`, `Instalación: ${install}\n${UNLOCK_012}`, `Guía: ${LINUX_KEYRING_GUIDE_URL}`].join('\n');
}

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
    [{ state: 'error', detail: foreignText('NoReply') }, 'inaccesible (NoReply)'],
    [{ state: 'error', detail: null }, 'inaccesible (error sin detalle)'],
  ] as const)('assess_linux_%o_mensajeD1SinTocarSafeStorage', async (diagnosis, state) => {
    const untouched = cipher();

    const status = await assessVault(deps({ cipher: untouched }, diagnosis));

    expect(status.usable).toBe(false);
    expect(status.usable === false && esText(status.reason).startsWith(`${D1_PREFIX} ${state}. ${D1_TAIL}`)).toBe(true);
    expect(untouched.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(untouched.encryptString).not.toHaveBeenCalled();
  });

  it('assess_linuxDesbloqueadoPeroBackendBasicText_noUsableSinCifrar', async () => {
    const plain = cipher({ getSelectedStorageBackend: () => 'basic_text' });

    const status = await assessVault(deps({ cipher: plain }));

    expect(status.usable === false && esText(status.reason)).toContain('sin usar: Electron eligió el backend inseguro «basic_text»');
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

    expect(status.usable === false && esText(status.reason)).toContain(`${D1_PREFIX} sin cifrado disponible.`);
  });

  it('assess_roundTripLanza_noUsableConElMotivo', async () => {
    const status = await assessVault(deps({ cipher: cipher({ decryptString: () => { throw new Error('Error while decrypting'); } }) }));

    expect(status.usable === false && esText(status.reason)).toContain('inaccesible: Error while decrypting');
  });

  it('assess_roundTripDevuelveOtroTexto_noUsable', async () => {
    const status = await assessVault(deps({ cipher: cipher({ decryptString: () => 'otro' }) }));

    expect(status.usable === false && esText(status.reason)).toContain('no devuelve el texto de prueba');
  });

  it('assess_windows_sinDiagnosticoDeLinuxYConRoundTrip', async () => {
    const detectKeyring = vi.fn();

    const status = await assessVault(deps({ platform: 'win32', cipher: cipher({ getSelectedStorageBackend: undefined }), detectKeyring }));

    expect(status).toEqual({ usable: true });
    expect(detectKeyring).not.toHaveBeenCalled();
  });

  it('assess_windowsSinCifrado_mensajeDelCifradoDelSistemaNoElDeLinux', async () => {
    const status = await assessVault(deps({ platform: 'win32', cipher: cipher({ isEncryptionAvailable: () => false }) }));

    expect(status.usable === false && esText(status.reason)).toBe('No se puede crear ni usar esta cuenta de API: el cifrado del sistema está sin cifrado disponible. Las cuentas de suscripción siguen disponibles.');
  });
});

describe('linuxKeyringMessage', () => {
  it('message_ubuntu_comandosDeAptYGuia', () => {
    const message = esText(linuxKeyringMessage(localized('errors.vault.stateLocked'), { id: 'ubuntu', idLike: ['debian'] }));

    expect(message).toContain('sudo apt install gnome-keyring libsecret-tools dbus-daemon');
    expect(message).toContain('gnome-keyring-daemon --unlock --components=secrets');
    expect(message).toContain(LINUX_KEYRING_GUIDE_URL);
  });

  it('message_arch_comandosDePacman', () => {
    expect(esText(linuxKeyringMessage(foreignText('ausente'), { id: 'arch', idLike: [] }))).toContain('sudo pacman -S --needed gnome-keyring libsecret dbus');
  });

  it('message_distribucionDesconocida_loDiceSinInventarComando', () => {
    const message = esText(linuxKeyringMessage(foreignText('ausente'), { id: 'fedora', idLike: ['rhel'] }));

    expect(message).toContain('Distribución no reconocida (ID=fedora)');
    expect(message).not.toMatch(/sudo (apt|pacman|dnf)/);
  });
});

describe('linuxKeyringMessage (claves)', () => {
  const locked = localized('errors.vault.stateLocked');

  it('linuxKeyringMessage_debianUbuntuArchYDesconocida_textoIdenticoAl012', () => {
    const debian = esText(linuxKeyringMessage(locked, { id: 'debian', idLike: [] }));
    const ubuntu = esText(linuxKeyringMessage(locked, { id: 'pop', idLike: ['ubuntu', 'debian'] }));
    const arch = esText(linuxKeyringMessage(locked, { id: 'arch', idLike: [] }));
    const unknown = esText(linuxKeyringMessage(locked, { id: 'fedora', idLike: ['rhel'] }));
    const noOs = esText(linuxKeyringMessage(locked, null));

    const apt = 'Ubuntu/Debian: sudo apt update && sudo apt install gnome-keyring libsecret-tools dbus-daemon';
    expect(debian).toBe(message012('bloqueado', apt));
    expect(ubuntu).toBe(message012('bloqueado', apt));
    expect(arch).toBe(message012('bloqueado', 'Arch: sudo pacman -S --needed gnome-keyring libsecret dbus'));
    expect(unknown).toBe(message012('bloqueado', 'Distribución no reconocida (ID=fedora): la guía explica qué instalar.'));
    expect(noOs).toBe(message012('bloqueado', 'Distribución no reconocida (ID=desconocido): la guía explica qué instalar.'));
  });

  it('linuxKeyringMessage_estadoYGuia_vanComoPartsYValor', () => {
    const text = linuxKeyringMessage(locked, null);

    expect(text.key).toBe('errors.vault.linuxUnavailable');
    expect(text.values).toEqual({ guideUrl: LINUX_KEYRING_GUIDE_URL });
    expect(text.parts?.['state']).toEqual(locked);
  });

  it('assess_estadoErrorSinDetalle_laParteDetailEsLaFraseSinDetalle', async () => {
    const status = await assessVault(deps({}, { state: 'error', detail: null }));

    const state = status.usable === false ? status.reason.parts?.['state'] : undefined;
    expect(state).toEqual(localizedWithParts('errors.vault.stateError', {}, { detail: localized('errors.vault.stateErrorNoDetail') }));
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
