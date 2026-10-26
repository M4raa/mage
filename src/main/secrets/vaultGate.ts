import type { KeyringDiagnosis, KeyringState } from './linuxKeyring';
import type { SecretCipher } from './secretStore';

// ¿Se puede usar la bóveda en este proceso? (D1, F2.7). Se decide UNA vez, al arrancar y antes de admitir sesiones,
// y no cambia mientras el proceso viva: un Mage que arrancó sin bóveda no la inicializa en segundo plano; para
// habilitarla hay que cerrarlo y volver a abrirlo (§3.4 del plan).
//
// Orden en Linux: primero el diagnóstico D-Bus (barato y con plazo); solo si el llavero está desbloqueado se toca
// `safeStorage` (síncrono, no se puede interrumpir). Después, en todas las plataformas, disponibilidad y un round trip
// con texto sintético: que el backend tenga nombre no demuestra que cifre.

export type VaultStatus = { readonly usable: true } | { readonly usable: false; readonly reason: string };

// Texto sintético del round trip. Nunca un secreto real.
export const VAULT_ROUND_TRIP_TEXT = 'mage: comprobación de la bóveda';

export const LINUX_KEYRING_GUIDE_URL = 'https://github.com/M4raa/mage/blob/main/docs/linux-keyring.md';

const INSECURE_BACKENDS: readonly string[] = ['basic_text', 'unknown'];
// Backends que no hablan con el Secret Service: el diagnóstico D-Bus no les dice nada.
const NON_SECRET_SERVICE_BACKENDS: readonly string[] = ['kwallet', 'kwallet5', 'kwallet6'];

export interface OsRelease {
  readonly id: string;
  readonly idLike: readonly string[];
}

export interface VaultGateDeps {
  readonly platform: NodeJS.Platform;
  readonly cipher: SecretCipher;
  readonly detectKeyring: () => Promise<KeyringDiagnosis>;
  readonly osRelease: () => OsRelease | null;
}

export async function assessVault(deps: VaultGateDeps): Promise<VaultStatus> {
  if (deps.platform === 'linux') {
    const blocked = await linuxBlocker(deps);
    if (blocked !== null) return blocked;
  }
  if (!deps.cipher.isEncryptionAvailable()) return unusable(deps, 'sin cifrado disponible');
  return roundTrip(deps);
}

// El motivo por el que el llavero de Linux no sirve, o null si se puede probar el cifrado.
async function linuxBlocker(deps: VaultGateDeps): Promise<VaultStatus | null> {
  const backend = deps.cipher.getSelectedStorageBackend?.() ?? 'unknown';
  if (NON_SECRET_SERVICE_BACKENDS.includes(backend)) return null;
  const diagnosis = await deps.detectKeyring();
  if (diagnosis.state !== 'unlocked') return unusable(deps, describeKeyringState(diagnosis));
  // Llavero desbloqueado pero Electron eligió un backend en claro: no se usa (nunca basic_text ni unknown).
  if (INSECURE_BACKENDS.includes(backend)) return unusable(deps, `sin usar: Electron eligió el backend inseguro «${backend}»`);
  return null;
}

function roundTrip(deps: VaultGateDeps): VaultStatus {
  try {
    const back = deps.cipher.decryptString(deps.cipher.encryptString(VAULT_ROUND_TRIP_TEXT));
    if (back !== VAULT_ROUND_TRIP_TEXT) return unusable(deps, 'inaccesible: el cifrado no devuelve el texto de prueba');
    return { usable: true };
  } catch (err) {
    return unusable(deps, `inaccesible: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const STATE_TEXT: Readonly<Record<Exclude<KeyringState, 'unlocked' | 'error'>, string>> = {
  absent: 'ausente (no hay ningún proveedor instalado)',
  'not-running': 'sin arrancar',
  locked: 'bloqueado',
  'no-collection': 'sin colección por defecto',
};

export function describeKeyringState(diagnosis: KeyringDiagnosis): string {
  if (diagnosis.state === 'unlocked') return 'desbloqueado';
  if (diagnosis.state === 'error') return `inaccesible (${diagnosis.detail ?? 'error sin detalle'})`;
  return STATE_TEXT[diagnosis.state];
}

function unusable(deps: VaultGateDeps, state: string): VaultStatus {
  return { usable: false, reason: deps.platform === 'linux' ? linuxKeyringMessage(state, deps.osRelease()) : systemCipherMessage(state) };
}

// El mensaje D1, literal del plan, con los comandos de la distribución y el enlace a la guía.
export function linuxKeyringMessage(state: string, os: OsRelease | null): string {
  return [
    `No se puede crear ni usar esta cuenta de API: el llavero seguro de Linux está ${state}. Las cuentas de suscripción siguen disponibles. ` +
      'Sigue las instrucciones de instalación, arranque y desbloqueo del llavero para tu distribución; después cierra y vuelve a abrir Mage para habilitar la bóveda.',
    distroInstructions(os),
    `Guía: ${LINUX_KEYRING_GUIDE_URL}`,
  ].join('\n');
}

function systemCipherMessage(state: string): string {
  return `No se puede crear ni usar esta cuenta de API: el cifrado del sistema está ${state}. Las cuentas de suscripción siguen disponibles.`;
}

const UNLOCK_INSTRUCTIONS =
  "Arranque y desbloqueo sin escritorio: dbus-run-session -- bash; después read -r -s keyring_password; printf '%s' \"$keyring_password\" | gnome-keyring-daemon --unlock --components=secrets; unset keyring_password; y arranca Mage desde esa shell.";

const INSTALL_BY_FAMILY: Readonly<Record<string, string>> = {
  debian: 'Ubuntu/Debian: sudo apt update && sudo apt install gnome-keyring libsecret-tools dbus-daemon',
  arch: 'Arch: sudo pacman -S --needed gnome-keyring libsecret dbus',
};

// Comandos de la distribución detectada por ID/ID_LIKE. Una desconocida lo dice, sin inventar un comando.
function distroInstructions(os: OsRelease | null): string {
  const family = os === null ? null : distroFamily(os);
  const install = family === null ? `Distribución no reconocida (ID=${os?.id ?? 'desconocido'}): la guía explica qué instalar.` : INSTALL_BY_FAMILY[family];
  return `Instalación: ${install}\n${UNLOCK_INSTRUCTIONS}`;
}

function distroFamily(os: OsRelease): string | null {
  const ids = [os.id, ...os.idLike];
  if (ids.some((id) => id === 'debian' || id === 'ubuntu')) return 'debian';
  if (ids.includes('arch')) return 'arch';
  return null;
}

// `/etc/os-release`: líneas CLAVE=valor, con o sin comillas. Solo interesan ID e ID_LIKE.
export function parseOsRelease(text: string): OsRelease | null {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match !== null) values.set(match[1]!, match[2]!.replace(/^["']|["']$/g, ''));
  }
  const id = values.get('ID');
  if (id === undefined || id.length === 0) return null;
  return { id, idLike: (values.get('ID_LIKE') ?? '').split(/\s+/).filter((value) => value.length > 0) };
}
