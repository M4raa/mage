import { z } from 'zod';
import type { AppSettings } from '@shared/settings';
import { CUSTOM_PROVIDER_ID_PREFIX, type CustomProvider } from '@shared/providers';

// Claves de API de los proveedores del usuario, guardadas en la boveda (`SecretStore`) y no en
// `app-settings.json`. Lo que aqui se decide es la costura entre los dos ficheros: con que id se
// guarda cada clave, que ve el renderer (`hasApiKey`) y como se pasa lo que habia en claro a la boveda.

// Lo minimo de la boveda que hace falta aqui (DI: los tests pasan un mapa en memoria).
export interface ProviderKeyVault {
  readonly set: (id: string, value: string) => void;
  readonly get: (id: string) => string | null;
  readonly has: (id: string) => boolean;
}

export function providerApiKeySecretId(providerId: string): string {
  return `provider-api-key:${providerId}`;
}

// El renderer ve si hay clave, nunca cual. La boveda manda sobre lo que diga el fichero de ajustes.
export function withApiKeyFlags(settings: AppSettings, vault: ProviderKeyVault): AppSettings {
  const customProviders = settings.customProviders.map((provider) => ({
    ...provider,
    hasApiKey: vault.has(providerApiKeySecretId(provider.id)),
  }));
  return { ...settings, customProviders };
}

// Parametros de «guardar la clave de un proveedor» (IPC). Solo proveedores DEL USUARIO: los de serie
// leen su clave del entorno de main y no tienen nada que guardar aqui.
const API_KEY_SET_SCHEMA = z.object({
  providerId: z.string().startsWith(CUSTOM_PROVIDER_ID_PREFIX),
  apiKey: z.string().trim().min(1),
});

export function parseApiKeySetParams(raw: unknown): { readonly providerId: string; readonly apiKey: string } {
  const result = API_KEY_SET_SCHEMA.safeParse(raw);
  // El mensaje NO cita el valor recibido: podria ser la propia clave.
  if (!result.success) throw new Error(`Peticion de clave de proveedor invalida: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return result.data;
}

export function parseProviderId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith(CUSTOM_PROVIDER_ID_PREFIX)) {
    throw new Error(`Id de proveedor del usuario invalido: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// Migracion de la 0.1.1: las `apiKey` que `app-settings.json` guardaba en claro pasan a la boveda.
// Recibe el TEXTO del fichero (null = no existe) y devuelve cuantas claves movio; quien llama reescribe
// el fichero despues, y el esquema de ajustes ya no conserva el campo, asi que sale limpio.
// Si la boveda lanza (sin cifrado), se propaga ANTES de reescribir nada: el fichero sigue teniendo las
// claves y no se pierde ninguna.
export function migrateLegacyProviderKeys(rawSettings: string | null, vault: ProviderKeyVault): number {
  const legacy = readLegacyKeys(rawSettings);
  for (const { id, apiKey } of legacy) vault.set(providerApiKeySecretId(id), apiKey);
  return legacy.length;
}

const LEGACY_SCHEMA = z.object({
  customProviders: z.array(z.object({ id: z.string().min(1), apiKey: z.string().optional() }).passthrough()),
});

function readLegacyKeys(rawSettings: string | null): readonly { readonly id: string; readonly apiKey: string }[] {
  if (rawSettings === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSettings);
  } catch (err) {
    // Un JSON roto no tiene claves que rescatar: `SettingsStore` ya lo trata como defaults.
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  const result = LEGACY_SCHEMA.safeParse(parsed);
  if (!result.success) return [];
  return result.data.customProviders.flatMap(({ id, apiKey }) => {
    const trimmed = (apiKey ?? '').trim();
    return trimmed.length === 0 ? [] : [{ id, apiKey: trimmed }];
  });
}
