// Catalogo de proveedores y modelos para los selectores de la UI. La verdad de los proveedores de serie
// vive en `@shared/providers` (la comparte main); aqui
// se FUSIONA con los proveedores que el usuario haya anadido en Configuracion (E2) y se valida el
// formulario de esa seccion. Todo son funciones puras: el estado lo trae el store.
import type { CustomProvider, ProviderModel } from '@shared/providers';
import { AGY_EFFORT_LEVELS, AGY_PROVIDER_ID, BUILT_IN_PROVIDERS, CUSTOM_PROVIDER_ID_PREFIX, chatCompletionsUrl } from '@shared/providers';
import { EFFORT_LEVELS, type RuntimeProbeResult } from '@shared/ipc';

export type ModelOption = ProviderModel;

export interface ProviderOption {
  readonly id: string;
  readonly label: string;
}

const FALLBACK_PROVIDER_ID = 'claude';

// Proveedores a ofrecer: los de serie + los del usuario. Se descarta un proveedor del usuario si su id
// colisiona (con uno de serie o con otro suyo: gana el primero) o si no declara NINGUN modelo — ofrecer
// un proveedor con el selector de modelo vacio no permitiria abrir una conversacion. La seccion de
// Configuracion si los lista todos, para poder arreglarlos.
export function providerOptions(customProviders: readonly CustomProvider[]): readonly ProviderOption[] {
  // Todos los de serie tienen adapter desde la 0.1.2 (Codex sobre `codex app-server`, sin verificar).
  const options: ProviderOption[] = BUILT_IN_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
  }));
  const seen = new Set(options.map((option) => option.id));
  for (const provider of customProviders) {
    if (seen.has(provider.id) || provider.models.length === 0) continue;
    seen.add(provider.id);
    options.push({ id: provider.id, label: provider.label });
  }
  return options;
}

// Etiqueta legible de un modelo. Si el proveedor lo declara, la suya; si no —un modelo arrastrado de
// otra conversacion, o uno que el usuario quito de su proveedor— el id crudo, que es mejor que un hueco.
export function modelLabel(providerId: string, modelId: string, customProviders: readonly CustomProvider[]): string {
  const models = providerModels(providerId, customProviders);
  return models?.find((model) => model.id === modelId)?.label ?? modelId;
}

// Modelos declarados por un proveedor, o null si no existe / no declara ninguno.
export function providerModels(providerId: string, customProviders: readonly CustomProvider[]): readonly ModelOption[] | null {
  const builtIn = BUILT_IN_PROVIDERS.find((provider) => provider.id === providerId);
  if (builtIn !== undefined) return builtIn.models;
  const own = customProviders.find((provider) => provider.id === providerId);
  if (own === undefined || own.models.length === 0) return null;
  return own.models;
}

// Primer modelo del proveedor: el fallback de F3 (`providerFallbackModel` de resolveDefaultModel).
export function providerFallbackModel(providerId: string, customProviders: readonly CustomProvider[]): string | null {
  return providerModels(providerId, customProviders)?.[0]?.id ?? null;
}

// Modelos a ofrecer para un proveedor, garantizando que el modelo ACTUAL siempre esta en la lista: si
// no lo esta (un modelo persistido de otra version, o uno escrito a mano), se anade al principio en vez
// de desaparecer del selector — que se leeria como "se me ha cambiado el modelo solo".
// Un proveedor desconocido (borrado de Configuracion, o de una version anterior) cae a los modelos de
// Claude, el unico con soporte completo.
//
// `claudeCatalog` (P-026 2.4): los modelos que el CLI publico para la cuenta (sesion viva o cache del
// sondeo). Si trae algo, manda sobre la lista fija de Claude, que queda de RESERVA.
export function modelOptionsForProvider(
  providerId: string,
  modelId: string,
  customProviders: readonly CustomProvider[] = [],
  claudeCatalog: readonly ModelOption[] = [],
): readonly ModelOption[] {
  const fallback = providerModels(FALLBACK_PROVIDER_ID, []) ?? [];
  const declared = providerModels(providerId, customProviders);
  const models = providerId === FALLBACK_PROVIDER_ID && claudeCatalog.length > 0 ? claudeModelOptions(claudeCatalog) : (declared ?? fallback);
  const shown = displayModelId(modelId, models);
  if (shown.length === 0 || models.some((model) => model.id === shown)) return models;
  return [{ id: modelId, label: modelId }, ...models];
}

// Id que ENSEÑA el selector para el modelo de una pestaña. Un `X[1m]` guardado de antes (la semilla de
// las cuentas hereda `model: opus[1m]` del settings.json de la principal) se enseña como su base `X`
// si esta en la lista: el 1M es ya el de todos, y ofrecer los dos seria el duplicado que se quito. El id
// guardado no se toca: el CLI lo sigue aceptando, y solo cambia si el usuario elige otro.
export function displayModelId(modelId: string, options: readonly ModelOption[]): string {
  if (!modelId.endsWith(ONE_MILLION_SUFFIX) || options.some((option) => option.id === modelId)) return modelId;
  const base = modelId.slice(0, -ONE_MILLION_SUFFIX.length);
  return options.some((option) => option.id === base) ? base : modelId;
}

// Id del CLI que no es un modelo sino «usa el por defecto» (`Default (recommended)`). Mage siempre
// lanza con un `--model` concreto, y `--model default` no esta medido: no se ofrece.
const CLI_DEFAULT_MODEL_ID = 'default';
const ONE_MILLION_SUFFIX = '[1m]';

// Selector de Claude con el catalogo del CLI tal cual (MEDIDO en 2.1.283: 11 entradas), menos `default`.
// Ya no se le añaden variantes `[1m]`: el 1M es el contexto de todos los modelos y el sufijo dejo de
// distinguir nada (usuario, 2026-09-26). Si un catalogo trae un id `[1m]` propio —el del perfil privado
// trae `claude-fable-5[1m]`, medido—, se respeta como uno mas.
export function claudeModelOptions(catalog: readonly ModelOption[]): readonly ModelOption[] {
  return catalog.filter((model) => model.id !== CLI_DEFAULT_MODEL_ID);
}

// --- Formulario de "Proveedores" en Configuracion (E2) ---

// Lo que el usuario teclea. Los modelos van como texto (ids separados por comas o saltos de linea):
// ponytail: sin descubrimiento automatico de modelos y sin etiqueta propia por modelo (label = id).
// Techo: hay que teclear los ids que expone el runtime. Se sube consultando /v1/models del proveedor.
// `apiKey` es una clave NUEVA ('' = no tocar la guardada): la guardada nunca vuelve al renderer, asi
// que el formulario no puede precargarla. `forgetApiKey` borra la guardada.
export interface CustomProviderDraft {
  readonly label: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly forgetApiKey: boolean;
  readonly models: string;
  // Ventana de contexto en tokens ('' = la pregunta el runtime al servidor) y herramientas (P-032 R7).
  readonly contextWindow: string;
  readonly supportsTools: ToolsChoice;
}

export type ToolsChoice = 'auto' | 'yes' | 'no';

// La ventana tiene que dejar sitio a la respuesta (la reserva del runtime es de 1024 tokens).
const MIN_CONTEXT_WINDOW = 1_025;

// Que hacer con la clave en la boveda de main al guardar el proveedor.
export type ApiKeyUpdate =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly value: string }
  | { readonly kind: 'delete' };

export type CustomProviderValidation =
  | { readonly ok: true; readonly provider: CustomProvider; readonly apiKeyUpdate: ApiKeyUpdate }
  | { readonly ok: false; readonly message: string };

export const EMPTY_CUSTOM_PROVIDER_DRAFT: CustomProviderDraft = {
  label: '',
  baseUrl: '',
  apiKey: '',
  forgetApiKey: false,
  models: '',
  contextWindow: '',
  supportsTools: 'auto',
};

// El borrador con el que se edita un proveedor ya guardado.
export function draftFromProvider(provider: CustomProvider): CustomProviderDraft {
  return {
    ...EMPTY_CUSTOM_PROVIDER_DRAFT,
    label: provider.label,
    baseUrl: provider.baseUrl,
    models: provider.models.map((model) => model.id).join(', '),
    contextWindow: provider.contextWindow === undefined ? '' : String(provider.contextWindow),
    supportsTools: provider.supportsTools === undefined ? 'auto' : provider.supportsTools ? 'yes' : 'no',
  };
}

// Lo que «Probar conexión» rellena: los modelos del servidor y, si los supo, ventana y herramientas.
// Lo que no supo se deja como estaba (nunca se borra lo que el usuario escribio).
export function applyRuntimeProbe(draft: CustomProviderDraft, result: RuntimeProbeResult): CustomProviderDraft {
  return {
    ...draft,
    ...(result.models === null || result.models.length === 0 ? {} : { models: result.models.join(', ') }),
    ...(result.contextWindow === null ? {} : { contextWindow: String(result.contextWindow) }),
    ...(result.supportsTools === null ? {} : { supportsTools: result.supportsTools ? 'yes' : 'no' }),
  };
}

// Ids de modelo de un texto libre, sin duplicados y sin huecos.
export function parseModelIds(text: string): readonly string[] {
  const ids = text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return [...new Set(ids)];
}

// Id estable derivado de la etiqueta, con prefijo (asi jamas colisiona con un proveedor de serie) y
// sufijo numerico si ya esta cogido. Mismo espiritu que nextRuleId: los ids persisten, no se reciclan.
export function nextCustomProviderId(label: string, taken: readonly string[]): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `${CUSTOM_PROVIDER_ID_PREFIX}${slug.length === 0 ? 'proveedor' : slug}`;
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

// Valida el formulario y devuelve el proveedor listo para guardar, o el motivo CONCRETO del rechazo (se
// pinta junto al formulario). `editingId` = null al anadir; al editar, ese id se conserva.
// La URL se valida con el MISMO parser que usa el runtime al llamar (chatCompletionsUrl), asi no se
// puede guardar una URL que la UI acepte y el motor no.
export function validateCustomProviderDraft(
  draft: CustomProviderDraft,
  existing: readonly CustomProvider[],
  editingId: string | null,
): CustomProviderValidation {
  const label = draft.label.trim();
  if (label.length === 0) return { ok: false, message: 'Ponle un nombre al proveedor.' };

  const urlError = describeBaseUrlError(draft.baseUrl);
  if (urlError !== null) return { ok: false, message: urlError };

  const modelIds = parseModelIds(draft.models);
  if (modelIds.length === 0) {
    return { ok: false, message: 'Indica al menos un modelo (ids separados por comas), p. ej. llama3, mistral.' };
  }
  const contextWindow = parseContextWindow(draft.contextWindow);
  if (contextWindow === null) {
    return { ok: false, message: `La ventana de contexto tiene que ser un número entero de tokens mayor que ${MIN_CONTEXT_WINDOW - 1} (o vacía).` };
  }

  // Ids ya cogidos (de serie + del usuario) para generar uno nuevo que no colisione. Al editar, el id
  // propio no cuenta: se conserva tal cual para no romper las pestanas y ajustes que ya lo referencian.
  const taken = [...BUILT_IN_PROVIDERS.map((provider) => provider.id), ...existing.map((provider) => provider.id)].filter(
    (id) => id !== editingId,
  );

  const apiKeyUpdate = resolveApiKeyUpdate(draft);
  const hadApiKey = existing.find((provider) => provider.id === editingId)?.hasApiKey ?? false;
  return {
    ok: true,
    provider: {
      id: editingId ?? nextCustomProviderId(label, taken),
      label,
      baseUrl: draft.baseUrl.trim(),
      hasApiKey: apiKeyUpdate.kind === 'keep' ? hadApiKey : apiKeyUpdate.kind === 'set',
      models: modelIds.map((id) => ({ id, label: id })),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(draft.supportsTools === 'auto' ? {} : { supportsTools: draft.supportsTools === 'yes' }),
    },
    apiKeyUpdate,
  };
}

// Linea de resultado de «Probar conexión».
export function runtimeProbeSummary(result: RuntimeProbeResult): string {
  const models = result.models?.length ?? 0;
  const parts = [
    `${models} modelo${models === 1 ? '' : 's'}`,
    result.contextWindow === null ? 'ventana: la del servidor no se supo' : `ventana de ${result.contextWindow} tokens`,
    result.supportsTools === null ? 'herramientas: sin saber' : result.supportsTools ? 'con herramientas' : 'sin herramientas',
  ];
  return `Conectado: ${parts.join(' · ')}.${result.warning === null ? '' : ` ${result.warning}`}`;
}

// '' = sin fijar (undefined); un numero valido; null = invalido.
function parseContextWindow(text: string): number | undefined | null {
  const clean = text.trim();
  if (clean.length === 0) return undefined;
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isSafeInteger(value) && value >= MIN_CONTEXT_WINDOW ? value : null;
}

// Una clave tecleada gana a «quitar la guardada»: es lo ultimo que el usuario quiso decir.
function resolveApiKeyUpdate(draft: CustomProviderDraft): ApiKeyUpdate {
  const typed = draft.apiKey.trim();
  if (typed.length > 0) return { kind: 'set', value: typed };
  return draft.forgetApiKey ? { kind: 'delete' } : { kind: 'keep' };
}

// Motivo por el que la URL base no sirve, o null si sirve. Reutiliza el parser del runtime: su Error ya
// trae el valor recibido, y aqui se acompana de un ejemplo (el mensaje crudo no basta para arreglarlo).
function describeBaseUrlError(baseUrl: string): string | null {
  try {
    chatCompletionsUrl(baseUrl);
    return null;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `${detail}. Ejemplo: http://localhost:11434/v1`;
  }
}

// Texto del campo de modelos a partir de un proveedor ya guardado (para precargar el formulario).
export function modelsToDraftText(models: readonly ModelOption[]): string {
  return models.map((model) => model.id).join(', ');
}

// --- Seccion unificada "Proveedores y modelos" (D2) ---

// Un proveedor tal y como lo lista Configuracion: TODOS, los de serie y los del usuario, con lo que la
// seccion necesita para pintar su ficha. `kind` dice a que apunta: 'cli' = un ejecutable local (su ruta
// la detecta main), 'http' = un endpoint OpenAI-compatible.
export interface ProviderEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: 'cli' | 'http';
  readonly baseUrl: string | null; // null en los de CLI
  readonly models: readonly ModelOption[]; // catalogo DECLARADO (el sondeado lo trae el probe)
  readonly custom: boolean; // del usuario -> se puede editar y borrar
  readonly effortLevels: readonly string[]; // vacio = ese proveedor no acepta --effort
}

// Niveles de `--effort` que acepta cada proveedor, MEDIDOS en sus CLI (no deducidos):
//   - `claude --help`: low, medium, high, xhigh, max (= EFFORT_LEVELS).
//   - `agy --help` (1.2.14): low, medium, high, max (= AGY_EFFORT_LEVELS).
//   - del usuario (runtime propio): NINGUNO. El runtime no tiene `--effort`, asi que
//     ofrecerlo seria un control que no hace nada.
export function effortLevelsForProvider(providerId: string): readonly string[] {
  if (providerId === 'claude') return EFFORT_LEVELS;
  if (providerId === AGY_PROVIDER_ID) return AGY_EFFORT_LEVELS;
  return [];
}


// Todos los proveedores configurables, de serie primero. A diferencia de `providerOptions` (que alimenta
// los selectores de conversacion) aqui NO se descarta ninguno: un proveedor del usuario sin modelos es
// precisamente el que hay que poder arreglar.
export function providerEntries(customProviders: readonly CustomProvider[]): readonly ProviderEntry[] {
  const builtIn: ProviderEntry[] = BUILT_IN_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: 'cli',
    baseUrl: null,
    models: provider.models,
    custom: false,
    effortLevels: effortLevelsForProvider(provider.id),
  }));
  const own: ProviderEntry[] = customProviders.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: 'http',
    baseUrl: provider.baseUrl,
    models: provider.models,
    custom: true,
    effortLevels: effortLevelsForProvider(provider.id),
  }));
  return [...builtIn, ...own];
}

// Clave con la que se guarda el ESFUERZO por defecto de un proveedor.
// ponytail: viaja en el mismo `defaultModelByProvider` (un Record<string,string> ya persistido y
// tolerante) bajo una clave con sufijo, en vez de anadir un campo nuevo a AppSettings. Ningun id de
// proveedor puede contener '#' (los de serie son literales y los del usuario llevan el prefijo
// `custom:` con slug [a-z0-9-]), asi que no colisiona. Techo: la clave sobrevive al borrar el
// proveedor; se sube moviendola a un `defaultEffortByProvider` propio en AppSettings.
const EFFORT_KEY_SUFFIX = '#effort';

export function effortSettingKey(providerId: string): string {
  return `${providerId}${EFFORT_KEY_SUFFIX}`;
}

// Esfuerzo por defecto guardado, o '' (= "Automático": se hereda el ultimo usado en la conversacion).
export function defaultEffortForProvider(
  defaults: Readonly<Record<string, string>>,
  providerId: string,
): string {
  return defaults[effortSettingKey(providerId)] ?? '';
}

// Modelo por defecto guardado, o '' (= "Automático"). Filtra la clave de esfuerzo: un proveedor que se
// llamara igual que la clave compuesta devolveria el nivel de esfuerzo como si fuera un modelo.
export function defaultModelForProvider(
  defaults: Readonly<Record<string, string>>,
  providerId: string,
): string {
  if (providerId.endsWith(EFFORT_KEY_SUFFIX)) return '';
  return defaults[providerId] ?? '';
}
