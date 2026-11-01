import { localized, localizedWithParts, wrapError, type LocalizedText } from '@shared/i18n/localizedText';
import type { KeyringDiagnosis, KeyringState } from './linuxKeyring';
import type { SecretCipher } from './secretStore';

// ¿Se puede usar la bóveda en este proceso? (D1, F2.7). Se decide UNA vez, al arrancar y antes de admitir sesiones,
// y no cambia mientras el proceso viva: un Mage que arrancó sin bóveda no la inicializa en segundo plano; para
// habilitarla hay que cerrarlo y volver a abrirlo (§3.4 del plan).
//
// Orden en Linux: primero el diagnóstico D-Bus (barato y con plazo); solo si el llavero está desbloqueado se toca
// `safeStorage` (síncrono, no se puede interrumpir). Después, en todas las plataformas, disponibilidad y un round trip
// con texto sintético: que el backend tenga nombre no demuestra que cifre.

export type VaultStatus = { readonly usable: true } | { readonly usable: false; readonly reason: LocalizedText };

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
  if (!deps.cipher.isEncryptionAvailable()) return unusable(deps, localized('errors.vault.stateNoCipher'));
  return roundTrip(deps);
}

// El motivo por el que el llavero de Linux no sirve, o null si se puede probar el cifrado.
async function linuxBlocker(deps: VaultGateDeps): Promise<VaultStatus | null> {
  const backend = deps.cipher.getSelectedStorageBackend?.() ?? 'unknown';
  if (NON_SECRET_SERVICE_BACKENDS.includes(backend)) return null;
  const diagnosis = await deps.detectKeyring();
  if (diagnosis.state !== 'unlocked') return unusable(deps, describeKeyringState(diagnosis));
  // Llavero desbloqueado pero Electron eligió un backend en claro: no se usa (nunca basic_text ni unknown).
  if (INSECURE_BACKENDS.includes(backend)) return unusable(deps, localized('errors.vault.stateInsecureBackend', { backend }));
  return null;
}

function roundTrip(deps: VaultGateDeps): VaultStatus {
  try {
    const back = deps.cipher.decryptString(deps.cipher.encryptString(VAULT_ROUND_TRIP_TEXT));
    if (back !== VAULT_ROUND_TRIP_TEXT) return unusable(deps, localized('errors.vault.stateRoundTripMismatch'));
    return { usable: true };
  } catch (err) {
    return unusable(deps, wrapError('errors.vault.stateRoundTripFailed', {}, err));
  }
}

type SimpleStateKey = 'errors.vault.stateAbsent' | 'errors.vault.stateNotRunning' | 'errors.vault.stateLocked' | 'errors.vault.stateNoCollection';

const STATE_TEXT: Readonly<Record<Exclude<KeyringState, 'unlocked' | 'error'>, SimpleStateKey>> = {
  absent: 'errors.vault.stateAbsent',
  'not-running': 'errors.vault.stateNotRunning',
  locked: 'errors.vault.stateLocked',
  'no-collection': 'errors.vault.stateNoCollection',
};

export function describeKeyringState(diagnosis: KeyringDiagnosis): LocalizedText {
  if (diagnosis.state === 'unlocked') return localized('errors.vault.stateUnlocked');
  if (diagnosis.state === 'error') {
    const detail = diagnosis.detail ?? localized('errors.vault.stateErrorNoDetail');
    return localizedWithParts('errors.vault.stateError', {}, { detail });
  }
  return localized(STATE_TEXT[diagnosis.state]);
}

function unusable(deps: VaultGateDeps, state: LocalizedText): VaultStatus {
  return { usable: false, reason: deps.platform === 'linux' ? linuxKeyringMessage(state, deps.osRelease()) : systemCipherMessage(state) };
}

// El mensaje D1, literal del plan, con los comandos de la distribución y el enlace a la guía.
export function linuxKeyringMessage(state: LocalizedText, os: OsRelease | null): LocalizedText {
  return localizedWithParts('errors.vault.linuxUnavailable', { guideUrl: LINUX_KEYRING_GUIDE_URL }, { state, instructions: distroInstructions(os) });
}

function systemCipherMessage(state: LocalizedText): LocalizedText {
  return localizedWithParts('errors.vault.systemCipherUnavailable', {}, { state });
}

// Comandos de la distribución detectada por ID/ID_LIKE. Una desconocida lo dice, sin inventar un comando.
function distroInstructions(os: OsRelease | null): LocalizedText {
  return localizedWithParts('errors.vault.installInstructions', {}, { install: installLine(os), unlock: localized('errors.vault.unlockInstructions') });
}

function installLine(os: OsRelease | null): LocalizedText {
  if (os === null) return localized('errors.vault.installUnknownNoId');
  const family = distroFamily(os);
  if (family === 'debian') return localized('errors.vault.installDebian');
  if (family === 'arch') return localized('errors.vault.installArch');
  return localized('errors.vault.installUnknown', { id: os.id });
}

function distroFamily(os: OsRelease): 'debian' | 'arch' | null {
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
