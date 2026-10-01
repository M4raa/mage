import { modelsUrl } from '@shared/providers';
import { LMSTUDIO_MODELS_SCHEMA, MODELS_LIST_SCHEMA, OLLAMA_SHOW_SCHEMA } from './chatSchemas';
import { redactUrl } from './chatClient';

// Lo que Mage sabe de un modelo de un endpoint OpenAI-compatible: su ventana de contexto y si admite
// herramientas. Fuentes por prioridad (P-032 §4.7):
//   1. lo que el usuario puso en su proveedor (`contextWindow`/`supportsTools`);
//   2. LM Studio `GET /api/v1/models`: el contexto CARGADO (`loaded_instances[].config.context_length`)
//      o el maximo, y `capabilities.trained_for_tool_use`;
//   3. Ollama `POST /api/show`: `model_info["<arq>.context_length"]` y `capabilities`. Ollama CARGA menos
//      de lo que declara si no se fija `num_ctx` (4k con menos de 24 GiB de VRAM), asi que se toma
//      min(declarado, OLLAMA_DEFAULT_CTX) y se avisa;
//   4. DEFAULT_CONTEXT_WINDOW.
// Con cache por (proveedor, modelo) y TTL: no se pregunta en cada turno.

export const DEFAULT_CONTEXT_WINDOW = 8_192;
export const OLLAMA_DEFAULT_CTX = 4_096;
export const MODEL_CATALOG_TTL_MS = 5 * 60_000;

export type ContextSource = 'manual' | 'lmstudio' | 'ollama' | 'default';

export interface ModelInfo {
  readonly contextWindow: number;
  readonly contextSource: ContextSource;
  // null = no se sabe: se mandan `tools` y, si el servidor las rechaza, el bucle pasa a solo chat.
  readonly supportsTools: boolean | null;
  // Aviso para el usuario (p.ej. la ventana real de Ollama es menor que la del modelo).
  readonly warning: string | null;
}

export interface CatalogEndpoint {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly contextWindow?: number;
  readonly supportsTools?: boolean;
}

export interface ModelCatalogDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly ttlMs?: number;
}

interface Probe {
  readonly contextWindow: number | null;
  readonly supportsTools: boolean | null;
  readonly source: Exclude<ContextSource, 'manual' | 'default'>;
  readonly declared?: number;
}

export class ModelCatalog {
  private readonly cache = new Map<string, { readonly at: number; readonly value: Promise<Probe | null> }>();

  constructor(private readonly deps: ModelCatalogDeps) {}

  // Ids de `GET /v1/models`. Lanza con el estado y la URL (sin credenciales) si el servidor falla.
  async listModels(endpoint: CatalogEndpoint): Promise<string[]> {
    const url = modelsUrl(endpoint.baseUrl);
    const response = await this.deps.fetch(url, { headers: authHeaders(endpoint.apiKey) });
    if (!response.ok) throw new Error(`El servidor respondió ${response.status} en ${redactUrl(url)}`);
    const parsed = MODELS_LIST_SCHEMA.safeParse(await response.json());
    if (!parsed.success) throw new Error(`Catálogo de modelos con forma inesperada en ${redactUrl(url)}`);
    return parsed.data.data.map((entry) => entry.id);
  }

  async info(endpoint: CatalogEndpoint, model: string): Promise<ModelInfo> {
    const probe = endpoint.contextWindow !== undefined && endpoint.supportsTools !== undefined ? null : await this.probe(endpoint, model);
    const supportsTools = endpoint.supportsTools ?? probe?.supportsTools ?? null;
    if (endpoint.contextWindow !== undefined) {
      if (!Number.isInteger(endpoint.contextWindow) || endpoint.contextWindow <= 0) {
        throw new Error(`Ventana de contexto invalida en el proveedor ${endpoint.id}: ${endpoint.contextWindow}`);
      }
      return { contextWindow: endpoint.contextWindow, contextSource: 'manual', supportsTools, warning: null };
    }
    if (probe === null || probe.contextWindow === null) {
      return { contextWindow: DEFAULT_CONTEXT_WINDOW, contextSource: 'default', supportsTools, warning: null };
    }
    return { contextWindow: probe.contextWindow, contextSource: probe.source, supportsTools, warning: ollamaWarning(probe, model) };
  }

  private probe(endpoint: CatalogEndpoint, model: string): Promise<Probe | null> {
    const key = `${endpoint.id}\u0000${endpoint.baseUrl}\u0000${model}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && this.deps.now() - cached.at < (this.deps.ttlMs ?? MODEL_CATALOG_TTL_MS)) return cached.value;
    const value = this.probeServers(endpoint, model);
    this.cache.set(key, { at: this.deps.now(), value });
    return value;
  }

  // Primero LM Studio, luego Ollama; un servidor que no es ninguno de los dos (404, otra forma) da null.
  private async probeServers(endpoint: CatalogEndpoint, model: string): Promise<Probe | null> {
    const root = serverRoot(endpoint.baseUrl);
    return (await this.probeLmStudio(root, endpoint.apiKey, model)) ?? (await this.probeOllama(root, endpoint.apiKey, model));
  }

  private async probeLmStudio(root: string, apiKey: string | null, model: string): Promise<Probe | null> {
    const body = await this.getJson(`${root}/api/v1/models`, { headers: authHeaders(apiKey) });
    const parsed = LMSTUDIO_MODELS_SCHEMA.safeParse(body);
    if (body === null || !parsed.success) return null;
    const entry = parsed.data.models.find((candidate) => candidate.key === model);
    if (entry === undefined) return null;
    const loaded = entry.loaded_instances?.find((instance) => instance.config?.context_length !== undefined)?.config?.context_length;
    return { contextWindow: loaded ?? entry.max_context_length ?? null, supportsTools: entry.capabilities?.trained_for_tool_use ?? null, source: 'lmstudio' };
  }

  private async probeOllama(root: string, apiKey: string | null, model: string): Promise<Probe | null> {
    const init = { method: 'POST', headers: { ...authHeaders(apiKey), 'content-type': 'application/json' }, body: JSON.stringify({ model }) };
    const body = await this.getJson(`${root}/api/show`, init);
    const parsed = OLLAMA_SHOW_SCHEMA.safeParse(body);
    if (body === null || !parsed.success) return null;
    const declared = declaredContextLength(parsed.data.model_info);
    const capabilities = parsed.data.capabilities;
    return {
      contextWindow: declared === null ? null : Math.min(declared, OLLAMA_DEFAULT_CTX),
      supportsTools: capabilities === undefined ? null : capabilities.includes('tools'),
      source: 'ollama',
      ...(declared === null ? {} : { declared }),
    };
  }

  // JSON de un GET/POST de sondeo, o null si el servidor no lo tiene (404, red caida, no es JSON): el
  // sondeo es OPCIONAL por diseño y su ausencia se resuelve con la fuente siguiente.
  private async getJson(url: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await this.deps.fetch(url, init);
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch (err) {
      // Red caida (`fetch` lanza TypeError) o cuerpo que no es JSON (SyntaxError): no es ese servidor.
      if (err instanceof TypeError || err instanceof SyntaxError) return null;
      throw err;
    }
  }
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey === null || apiKey.length === 0 ? {} : { authorization: `Bearer ${apiKey}` };
}

// `http://host:11434/v1` -> `http://host:11434`: las API propias de Ollama y LM Studio cuelgan de la raiz.
export function serverRoot(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return url.toString().replace(/\/+$/, '');
}

function declaredContextLength(modelInfo: Readonly<Record<string, unknown>> | undefined): number | null {
  if (modelInfo === undefined) return null;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function ollamaWarning(probe: Probe, model: string): string | null {
  if (probe.source !== 'ollama' || probe.declared === undefined || probe.declared <= OLLAMA_DEFAULT_CTX) return null;
  return (
    `${model} admite ${probe.declared} tokens, pero Ollama solo carga ${OLLAMA_DEFAULT_CTX} si no se le dice otra cosa. ` +
    'Para usar más, arranca Ollama con OLLAMA_CONTEXT_LENGTH o fija num_ctx en un Modelfile, y pon la ventana en el proveedor.'
  );
}
