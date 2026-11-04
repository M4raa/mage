// Claves de los MCP de la biblioteca (ruta `mageMcp`): su id en la bóveda, su validación y el redactado de las
// peticiones inválidas. Todo puro. Ningún mensaje de error lleva el valor de una clave.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import type { LibraryKey } from './libraryState';

// Misma forma que `ExtensionVault`; se redefine aquí para no importar de config.
export interface LibraryVault {
  readonly get: (id: string) => string | null;
  readonly set: (id: string, value: string) => void;
  readonly has: (id: string) => boolean;
  readonly delete: (id: string) => void;
}

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SECRET_MAX_CHARS = 4096;
export const REDACTED = '<oculto>';
const ACCOUNT_HASH_HEX_CHARS = 16;

// `library|<motor>|<huella de la cuenta>|<paquete>|<nombre>`: una clave por cuenta, motor y paquete.
export function librarySecretId(key: LibraryKey, name: string, caseInsensitive: boolean): string {
  const dir = resolve(key.accountDir);
  const normalized = caseInsensitive ? dir.toLowerCase() : dir;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, ACCOUNT_HASH_HEX_CHARS);
  return `library|${key.engine}|${hash}|${key.packageId}|${name}`;
}

export function validateLibrarySecrets(
  required: readonly string[],
  given: Readonly<Record<string, string>> | undefined,
  packageId: string,
): Record<string, string> {
  const values = given ?? {};
  const names = Object.keys(values);
  const trimmed = Object.fromEntries(names.map((name) => [name, values[name]?.trim() ?? '']));
  const exact = names.length === required.length && required.every((name) => name in trimmed);
  const usable = names.every((name) => SECRET_NAME.test(name) && isUsableValue(trimmed[name] as string));
  if (!exact || !usable) {
    throw new UserFacingError(localized('library.error.secretsRequired', { packageId, names: required.join(', ') }));
  }
  return trimmed;
}

function isUsableValue(value: string): boolean {
  return value.length > 0 && value.length <= SECRET_MAX_CHARS;
}

// Copia del payload crudo con los valores de `secrets` ocultos: es lo único que puede acabar en un mensaje de error.
export function redactSecrets(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('secrets' in raw)) return raw;
  const { secrets } = raw as { secrets: unknown };
  const isRecord = typeof secrets === 'object' && secrets !== null && !Array.isArray(secrets);
  const hidden = isRecord ? Object.fromEntries(Object.keys(secrets).map((name) => [name, REDACTED])) : REDACTED;
  return { ...raw, secrets: hidden };
}

// Acceso a la bóveda por (cuenta, motor, paquete). Quien llama pasa `caseInsensitive` de la plataforma.
export interface LibrarySecretScope {
  readonly vault: LibraryVault;
  readonly key: LibraryKey;
  readonly caseInsensitive: boolean;
}

export function storeLibrarySecrets(scope: LibrarySecretScope, values: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(values)) {
    scope.vault.set(librarySecretId(scope.key, name, scope.caseInsensitive), value);
  }
}

export function clearLibrarySecrets(scope: LibrarySecretScope, names: readonly string[]): void {
  for (const name of names) scope.vault.delete(librarySecretId(scope.key, name, scope.caseInsensitive));
}

export function hasLibrarySecrets(scope: LibrarySecretScope, names: readonly string[]): boolean {
  return names.every((name) => scope.vault.has(librarySecretId(scope.key, name, scope.caseInsensitive)));
}
