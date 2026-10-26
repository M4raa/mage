import { isOnPath } from '../os/commandOnPath';
import { createDbusSend, type ExecFileFn } from './dbusSend';
import { detectLinuxKeyring, hasSessionBus } from './linuxKeyring';
import type { SecretCipher } from './secretStore';
import { assessVault, parseOsRelease, type VaultStatus } from './vaultGate';

// El ensamblaje de la comprobación de la bóveda con lo que da el sistema (D1, F2.7). Lo usan `index.ts` al arrancar y
// la sonda `spike/vault-gate-probe.cjs`, para medir en cada plataforma EXACTAMENTE lo que hace la app.

// Proveedores del Secret Service que se reconocen como instalados (para distinguir «ausente» de «sin arrancar»).
export const KEYRING_PROVIDER_BINARIES: readonly string[] = ['gnome-keyring-daemon', 'kwalletd6', 'kwalletd5', 'keepassxc'];
export const OS_RELEASE_FILES: readonly string[] = ['/etc/os-release', '/usr/lib/os-release'];

export interface VaultBootstrapDeps {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cipher: SecretCipher;
  readonly execFile: ExecFileFn;
  // ¿Existe y es ejecutable? Se busca en el PATH sin `which`, que Arch no trae (medido en F2.7).
  readonly isExecutableFile: (path: string) => boolean;
  // Contenido de un fichero de texto, o null si no existe.
  readonly readTextFile: (path: string) => string | null;
  readonly now: () => number;
}

export function assessVaultForProcess(deps: VaultBootstrapDeps): Promise<VaultStatus> {
  return assessVault({
    platform: deps.platform,
    cipher: deps.cipher,
    detectKeyring: () =>
      detectLinuxKeyring({
        hasSessionBus: hasSessionBus(deps.env),
        providerInstalled: () => KEYRING_PROVIDER_BINARIES.some((bin) => isOnPath(bin, deps)),
        busCall: createDbusSend(deps.execFile),
        now: deps.now,
      }),
    osRelease: () => readOsRelease(deps.readTextFile),
  });
}

function readOsRelease(readTextFile: (path: string) => string | null): ReturnType<typeof parseOsRelease> {
  for (const file of OS_RELEASE_FILES) {
    const text = readTextFile(file);
    if (text !== null) return parseOsRelease(text);
  }
  return null;
}
