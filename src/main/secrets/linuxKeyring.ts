// Detección acotada del llavero seguro de Linux (D1, F2.7). Dice en qué estado está el Secret Service ANTES de
// llamar a `safeStorage`, que es síncrono y no se puede interrumpir: si el llavero no sirve, ni se toca.
//
// Reglas medidas en F0.5c:
//   - D-Bus SIN activación implícita: sin `DBUS_SESSION_BUS_ADDRESS` no se pregunta (dbus-send intentaría autolanzar
//     un bus), y al servicio solo se le habla si `NameHasOwner` dice que ya tiene dueño (preguntar al bus por un
//     nombre no lo arranca);
//   - 500 ms por consulta dentro de un plazo total de 3000 ms;
//   - ausente, sin arrancar, bloqueado, sin colección y error se distinguen; un error no se lee como «no instalado».
// Puro: el bus y el reloj se inyectan.

import { localized, localizedFromError, UserFacingError, type LocalizedText } from '@shared/i18n/localizedText';

export const DBUS_QUERY_TIMEOUT_MS = 500;
export const KEYRING_CHECK_BUDGET_MS = 3000;

// Lo que se cita de una respuesta ajena de D-Bus en un mensaje.
const MAX_REPLY_CHARS = 200;
const SECRET_SERVICE = 'org.freedesktop.secrets';

export type KeyringState = 'absent' | 'not-running' | 'locked' | 'no-collection' | 'error' | 'unlocked';

// ¿Hay un bus de sesión al que preguntar? Chromium pone `DBUS_SESSION_BUS_ADDRESS=disabled:` cuando no hay ninguno
// (para que nada lo autolance; medido en F2.7 con Electron 44 sin bus): eso NO es un bus.
export function hasSessionBus(env: Readonly<Record<string, string | undefined>>): boolean {
  const address = env['DBUS_SESSION_BUS_ADDRESS'] ?? '';
  return address.length > 0 && !address.startsWith('disabled:');
}

export interface KeyringDiagnosis {
  readonly state: KeyringState;
  // Qué falló, solo en `error` (sin datos del llavero: el mensaje de dbus-send o el plazo).
  readonly detail: LocalizedText | null;
}

// Una llamada D-Bus con plazo: la salida de `dbus-send --print-reply`, o rechaza (error o plazo agotado).
export type BusCall = (destination: string, objectPath: string, method: string, args: readonly string[], timeoutMs: number) => Promise<string>;

export interface KeyringDetectorDeps {
  readonly hasSessionBus: boolean;
  // ¿Hay un proveedor de Secret Service instalado (gnome-keyring, kwallet, keepassxc)?
  readonly providerInstalled: () => boolean;
  readonly busCall: BusCall;
  readonly now: () => number;
}

export async function detectLinuxKeyring(deps: KeyringDetectorDeps): Promise<KeyringDiagnosis> {
  const notRunning = (): KeyringDiagnosis => ({ state: deps.providerInstalled() ? 'not-running' : 'absent', detail: null });
  if (!deps.hasSessionBus) return notRunning();
  const query = budgetedQuery(deps);
  try {
    const owner = await query('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', [`string:${SECRET_SERVICE}`]);
    if (!isTrue(owner)) return notRunning();
    const collection = defaultCollection(await query(SECRET_SERVICE, '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service.ReadAlias', ['string:default']));
    if (collection === null) return { state: 'no-collection', detail: null };
    const locked = await query(SECRET_SERVICE, collection, 'org.freedesktop.DBus.Properties.Get', ['string:org.freedesktop.Secret.Collection', 'string:Locked']);
    return { state: isTrue(locked) ? 'locked' : 'unlocked', detail: null };
  } catch (err) {
    return { state: 'error', detail: localizedFromError(err) };
  }
}

// Cada consulta tiene 500 ms o lo que quede del plazo total, lo que sea menor; sin plazo, ni se lanza.
function budgetedQuery(deps: KeyringDetectorDeps): (destination: string, objectPath: string, method: string, args: readonly string[]) => Promise<string> {
  const deadline = deps.now() + KEYRING_CHECK_BUDGET_MS;
  return (destination, objectPath, method, args) => {
    const remaining = deadline - deps.now();
    if (remaining <= 0) return Promise.reject(new UserFacingError(localized('errors.vault.keyringTimeout', { budgetMs: String(KEYRING_CHECK_BUDGET_MS), method })));
    return deps.busCall(destination, objectPath, method, args, Math.min(DBUS_QUERY_TIMEOUT_MS, remaining));
  };
}

function isTrue(reply: string): boolean {
  return /\bboolean true\b/.test(reply);
}

// `ReadAlias` devuelve la ruta de la colección por defecto, o `/` si no hay ninguna.
function defaultCollection(reply: string): string | null {
  const found = /object path "([^"]+)"/.exec(reply);
  if (found === null) throw new UserFacingError(localized('errors.vault.readAliasNoPath', { reply: reply.trim().slice(0, MAX_REPLY_CHARS) }));
  return found[1] === '/' ? null : found[1]!;
}
