import { z } from 'zod';
import type { RuntimeProbeParams, RuntimeProbeResult } from '@shared/ipc';
import { CUSTOM_PROVIDER_ID_PREFIX } from '@shared/providers';
import type { ModelCatalog } from './modelCatalog';

// «Probar conexión» del formulario de proveedor (P-032 R7): lista los modelos del endpoint y, del
// primero, la ventana y si admite herramientas, para rellenar el formulario sin tocar JSON.
// La clave NUNCA llega del renderer: si el proveedor ya existe, sale de la boveda por su id, y SOLO si
// la URL que se prueba es la que tiene guardada (A2 de la revision): si no, el renderer elegiria adonde
// viaja la clave, que equivale a leerla.

// `.strict()`: una peticion con cualquier otro campo (una `apiKey`, por ejemplo) se rechaza entera.
const PARAMS_SCHEMA = z
  .object({
    providerId: z.string().startsWith(CUSTOM_PROVIDER_ID_PREFIX).nullable(),
    baseUrl: z.string().trim().min(1),
  })
  .strict();

export function parseRuntimeProbeParams(raw: unknown): RuntimeProbeParams {
  const result = PARAMS_SCHEMA.safeParse(raw);
  // El mensaje no cita valores: podria venir una clave en un campo que no toca.
  if (!result.success) throw new Error(`Peticion de prueba de conexion invalida: ${result.error.issues.map((i) => i.path.join('.') || i.code).join(', ')}`);
  return result.data;
}

export interface RuntimeProbeDeps {
  readonly catalog: ModelCatalog;
  readonly apiKeyFor: (providerId: string) => string | null;
  // URL base del proveedor guardado en ajustes; null si no existe.
  readonly savedBaseUrlFor: (providerId: string) => string | null;
}

export async function probeRuntimeEndpoint(params: RuntimeProbeParams, deps: RuntimeProbeDeps): Promise<RuntimeProbeResult> {
  const apiKey = savedKeyFor(params, deps);
  const endpoint = { id: params.providerId ?? 'custom:nuevo', baseUrl: params.baseUrl, apiKey };
  let models: string[];
  try {
    models = await deps.catalog.listModels(endpoint);
  } catch (err) {
    return { models: null, contextWindow: null, supportsTools: null, warning: null, error: `No se pudo conectar: ${scrub(err, apiKey)}` };
  }
  const first = models[0];
  if (first === undefined) return { models, contextWindow: null, supportsTools: null, warning: null, error: null };
  const info = await deps.catalog.info(endpoint, first);
  return {
    models,
    contextWindow: info.contextSource === 'default' ? null : info.contextWindow,
    supportsTools: info.supportsTools,
    warning: info.warning,
    error: null,
  };
}

function savedKeyFor(params: RuntimeProbeParams, deps: RuntimeProbeDeps): string | null {
  if (params.providerId === null) return null;
  const saved = deps.savedBaseUrlFor(params.providerId);
  if (saved === null || !sameEndpoint(saved, params.baseUrl)) return null;
  return deps.apiKeyFor(params.providerId);
}

// Misma URL salvo mayusculas del host, puerto por defecto y barras finales. Una URL que no se puede
// leer no coincide con nada (y la prueba fallara al conectar, con su propio error).
function sameEndpoint(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false;
  const norm = (raw: string) => {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  };
  return norm(a) === norm(b);
}

function scrub(err: unknown, apiKey: string | null): string {
  const message = err instanceof Error ? err.message : String(err);
  return apiKey === null || apiKey.length === 0 ? message : message.split(apiKey).join('***');
}
