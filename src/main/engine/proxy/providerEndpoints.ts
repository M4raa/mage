import type { BuiltInProvider, CustomProvider } from '@shared/providers';
import { BUILT_IN_PROVIDERS, chatCompletionsUrl } from '@shared/providers';

// Resolucion del upstream de una sesion por gateway (E2). Modulo PURO: recibe el registro de
// proveedores del usuario y el entorno como datos, asi que decide sin FS, sin red y sin process.env.
// Sustituye al if/else-if de `forwardRequest`, que llevaba las URLs y las keys incrustadas: anadir un
// proveedor es ahora anadir un dato, no una rama.

export interface UpstreamTarget {
  readonly url: string; // endpoint completo de chat/completions
  readonly apiKey: string; // '' = no se manda cabecera Authorization (runtimes locales)
  readonly model: string; // modelo YA resuelto (alias de los built-in aplicados)
}

// Proveedor del usuario con su clave YA descifrada de la boveda. Tipo solo de main: el `CustomProvider`
// compartido no lleva clave, porque viaja al renderer.
export interface KeyedCustomProvider extends CustomProvider {
  readonly apiKey: string; // '' = sin clave
}

export interface UpstreamResolutionInput {
  readonly providerId: string;
  readonly model: string;
  readonly customProviders: readonly KeyedCustomProvider[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

// Devuelve a donde reenviar la peticion, o lanza Error con el valor recibido en el mensaje (el gateway
// lo convierte en un 400 legible: es lo unico que vera el usuario cuando su proveedor este mal puesto).
// Un proveedor de serie GANA sobre uno del usuario con el mismo id: los ids del usuario llevan prefijo
// y no pueden colisionar, asi que una colision solo puede venir de un fichero editado a mano.
export function resolveUpstream(input: UpstreamResolutionInput): UpstreamTarget {
  const providerId = input.providerId.trim();
  if (providerId.length === 0) throw new Error('La sesion no declara proveedor');
  if (input.model.trim().length === 0) {
    throw new Error(`La sesion del proveedor ${JSON.stringify(providerId)} no declara modelo`);
  }

  const builtIn = BUILT_IN_PROVIDERS.find((provider) => provider.id === providerId);
  if (builtIn !== undefined) return resolveBuiltIn(builtIn, input);

  const own = input.customProviders.find((provider) => provider.id === providerId);
  if (own !== undefined) return resolveCustom(own, input.model);

  throw new Error(
    `Proveedor no configurado: ${JSON.stringify(providerId)}. Anadelo en Configuracion > Proveedores.`,
  );
}

function resolveBuiltIn(provider: BuiltInProvider, input: UpstreamResolutionInput): UpstreamTarget {
  if (provider.baseUrl === null) {
    throw new Error(`El proveedor ${JSON.stringify(provider.id)} es nativo y no pasa por el gateway`);
  }
  const apiKey = readEnvApiKey(provider, input.env);
  return {
    url: chatCompletionsUrl(provider.baseUrl),
    apiKey,
    model: provider.modelAliases[input.model] ?? input.model,
  };
}

// La key de un built-in viene SOLO del entorno del proceso main (nunca del fichero de config ni del
// entorno del CLI hijo). Ausente o en blanco = error explicito: el 401 del upstream no diria por que.
function readEnvApiKey(provider: BuiltInProvider, env: Readonly<Record<string, string | undefined>>): string {
  if (provider.apiKeyEnvVar === null) return '';
  const apiKey = (env[provider.apiKeyEnvVar] ?? '').trim();
  if (apiKey.length === 0) {
    throw new Error(
      `Falta la variable de entorno ${provider.apiKeyEnvVar} para el proveedor ${JSON.stringify(provider.id)}`,
    );
  }
  return apiKey;
}

// ponytail: los proveedores del usuario NO traducen alias de modelo (el id viaja tal cual). El selector
// ya ofrece solo los modelos declarados por el proveedor, asi que un 'sonnet' aqui seria un id escrito a
// mano. Techo: no auto-mapea; se sube declarando alias por proveedor en su formulario.
function resolveCustom(provider: KeyedCustomProvider, model: string): UpstreamTarget {
  return { url: chatCompletionsUrl(provider.baseUrl), apiKey: provider.apiKey.trim(), model };
}
