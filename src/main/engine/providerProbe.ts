import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { ProviderProbeParams, ProviderProbeResult } from '@shared/ipc';
import type { ProviderModel } from '@shared/providers';
import { AGY_PROVIDER_ID, BUILT_IN_PROVIDERS, CODEX_PROVIDER_ID, modelsUrl } from '@shared/providers';
import { resolveClaudeBinary } from '../os/claudeBinaryResolver';
import { findAgyBinary } from '../os/agyBinaryResolver';
import { findCodexBinary } from '../os/codexBinaryResolver';
import { execCapturingStdout } from '../os/execCapture';

// Sondeo de un proveedor para la seccion "Proveedores y modelos" de Configuracion (D2): a donde apunta
// (ruta del binario detectada, o URL del endpoint) y que modelos ofrece DE VERDAD.
//
// Que se puede preguntar y que no, MEDIDO el 2026-09-18 contra los CLI reales (no deducido de su
// --help, que ya mintio una vez):
//   - `agy models` -> una linea por modelo, `id<TAB>etiqueta`, precedida de "Fetching available
//     models...". Se consulta en vivo: la lista de `BUILT_IN_PROVIDERS` ya estaba desfasada (la cuenta
//     real ofrece Gemini 3.8 y 3.7, que no figuran ahi).
//   - `claude` NO tiene ningun subcomando ni flag que liste modelos, pero SI los publica en la respuesta
//     a `initialize` (P-026 2.4, medido en 2.1.283 con `spike/init-spike.mjs`, sin turno). Main los
//     sondea al arrancar y los guarda por cuenta; aqui se lee esa cache (`loadClaudeModels`).
//   - proveedores por gateway (openai/gemini) y del usuario: `GET <base>/models` (convencion OpenAI).

// CORRECCION del 2026-09-18, MEDIDA sobre el bundle del CLI 2.1.276: era FALSO decir que el catalogo
// de Claude no se puede descubrir. El propio CLI lo pide a `https://api.anthropic.com/v1/models`
// (usando ademas `?beta=true` y `?limit=1000`). Lo que no existe es un SUBCOMANDO que lo liste, que es
// cosa distinta — y confundir las dos es lo que produjo la afirmacion equivocada.
//
// Mage puede hacer la misma llamada: el camino ya esta montado en `usage/usageService.ts`, que lee el
// token OAuth de la cuenta SOLO para la cabecera Authorization y jamas lo cachea ni lo loguea.
//
// Esa llamada NO se hace: seria el Bearer FUERA del camino del CLI. El catalogo sale del propio CLI, por `initialize` (P-026 2.4).
export const CLAUDE_NO_CATALOG_REASON =
  'Todavía no se ha sondeado el catálogo de esta cuenta (se pide al CLI al arrancar Mage): mientras, ' +
  'la lista de reserva de Mage. Puedes escribir cualquier id de modelo a mano.';

export const CODEX_NO_ADAPTER_REASON =
  'Detectado, pero todavía no se puede usar: falta el adapter de Mage para su protocolo. Codex sí ' +
  'expone `codex exec --json`; lo que no se ha podido medir es el stream de un turno real, porque esta ' +
  'máquina no tiene cuenta de Codex. No se escribe a ciegas.';

// Tiempos: un sondeo es interactivo, no puede colgar la pantalla de Configuracion.
const CLI_TIMEOUT_MS = 20_000;
const HTTP_TIMEOUT_MS = 10_000;
// Cuanto cuerpo de respuesta se cita en un Error (el contrato pide el valor recibido, pero un JSON
// entero en un mensaje no ayuda a nadie).
const BODY_IN_ERROR_MAX = 200;

// Dependencias inyectables -> testable sin FS, sin procesos y sin red.
export interface ProbeDeps {
  readonly findClaudeBinary: () => string | null;
  readonly findAgyBinary: () => string | null;
  readonly findCodexBinary: () => string | null;
  readonly runCli: (bin: string, args: readonly string[]) => Promise<string>;
  readonly fetchJson: (url: string, apiKey: string) => Promise<unknown>;
  readonly env: Readonly<Record<string, string | undefined>>;
  // Clave de un proveedor DEL USUARIO, de la boveda de main ('' = no tiene). Nunca viaja por IPC.
  readonly readCustomApiKey: (providerId: string) => string;
  // Catalogo de Claude cacheado de la cuenta principal (P-026 2.4); vacio si aun no se sondeo.
  readonly loadClaudeModels: () => readonly ProviderModel[];
}

// Sondea un proveedor. NUNCA lanza por un fallo del proveedor (binario ausente, endpoint caido, JSON
// raro): eso es informacion para la UI y viaja en `error`. Solo lanza si la PETICION es invalida.
export async function probeProvider(
  params: ProviderProbeParams,
  deps: ProbeDeps,
): Promise<ProviderProbeResult> {
  const providerId = params.providerId.trim();
  if (providerId.length === 0) {
    throw new Error(`El sondeo necesita un id de proveedor (recibido: ${JSON.stringify(params.providerId)})`);
  }
  if (providerId === 'claude') return probeClaude(deps);
  if (providerId === AGY_PROVIDER_ID) return probeAgy(deps);
  if (providerId === CODEX_PROVIDER_ID) return probeCodex(deps);
  return probeHttp(providerId, params, deps);
}

// Claude: el binario y el catalogo que dio su `initialize` (cacheado por main; ver cabecera).
function probeClaude(deps: ProbeDeps): ProviderProbeResult {
  const bin = deps.findClaudeBinary();
  if (bin === null) {
    return { kind: 'cli', endpoint: null, models: null, error: 'No se encontró el binario de Claude Code. Fija MAGE_CLAUDE_BIN con su ruta.' };
  }
  const models = deps.loadClaudeModels();
  return models.length === 0
    ? { kind: 'cli', endpoint: bin, models: null, error: CLAUDE_NO_CATALOG_REASON }
    : { kind: 'cli', endpoint: bin, models, error: null };
}

// agy: binario por el resolutor de siempre y catalogo por `agy models` contra la cuenta real.
async function probeAgy(deps: ProbeDeps): Promise<ProviderProbeResult> {
  const bin = deps.findAgyBinary();
  if (bin === null) {
    return {
      kind: 'cli',
      endpoint: null,
      models: null,
      error: 'No se encontró el CLI de Antigravity. Instálalo y ejecuta `agy install`, o fija MAGE_AGY_BIN.',
    };
  }
  try {
    const stdout = await deps.runCli(bin, ['models']);
    return { kind: 'cli', endpoint: bin, models: parseAgyModelsOutput(stdout), error: null };
  } catch (err) {
    return { kind: 'cli', endpoint: bin, models: null, error: `No se pudo listar: ${describe(err)}` };
  }
}

// Codex (OpenAI). MEDIDO el 2026-09-18 contra codex-cli 0.144.4 en la maquina del usuario:
//   - `codex exec --json` imprime eventos JSONL por stdout, y acepta `-C/--cd`, `--add-dir`,
//     `-m/--model` y `codex exec resume` — o sea que el protocolo encaja con el motor de Mage.
//   - NO hay puente de permisos. El oraculo de flags rechaza `--permission-prompt-tool`,
//     `--approval-mode` y `--ask-for-approval`; lo unico que hay es `--sandbox`
//     (read-only | workspace-write | danger-full-access), que es una politica estatica. Por eso Codex
//     entra en AUTO_APPROVED_PROVIDER_IDS, igual que `agy`.
//   - NO publica su catalogo de modelos: no hay ningun comando que los liste (`features list` es de
//     feature flags). Mismo caso que Claude, y se dice en la UI en vez de inventarlo.
// Lo que FALTA para poder usarlo es el adapter, y falta porque no se ha podido medir el stream de
// eventos de un turno real: la maquina no tiene cuenta de Codex (`codex login status` -> "Not logged
// in"). Deducirlo del `--help` es exactamente lo que la skill `protocolo-cli` prohibe.
function probeCodex(deps: ProbeDeps): ProviderProbeResult {
  const bin = deps.findCodexBinary();
  return {
    kind: 'cli',
    endpoint: bin,
    models: null,
    error:
      bin === null
        ? 'No se encontró el CLI de Codex. Instálalo, o fija MAGE_CODEX_BIN con su ruta.'
        : CODEX_NO_ADAPTER_REASON,
  };
}

// Proveedores OpenAI-compatibles (de serie por gateway, o del usuario): GET <base>/models.
async function probeHttp(
  providerId: string,
  params: ProviderProbeParams,
  deps: ProbeDeps,
): Promise<ProviderProbeResult> {
  const target = resolveHttpTarget(providerId, params, deps);
  if (typeof target === 'string') return { kind: 'http', endpoint: null, models: null, error: target };
  try {
    const url = modelsUrl(target.baseUrl);
    return { kind: 'http', endpoint: url, models: parseOpenAiModels(await deps.fetchJson(url, target.apiKey)), error: null };
  } catch (err) {
    return { kind: 'http', endpoint: target.baseUrl, models: null, error: `No se pudo listar: ${describe(err)}` };
  }
}

interface HttpTarget {
  readonly baseUrl: string;
  readonly apiKey: string;
}

// URL y credencial con las que sondear. Un proveedor de serie las saca de su ficha y del entorno del
// main; uno del usuario trae la URL en la peticion y su clave sale de la boveda (la key nunca viaja por
// IPC). Devuelve el MOTIVO (una cadena) cuando no hay con que sondear, que es informacion para la UI y
// no un fallo del programa.
function resolveHttpTarget(providerId: string, params: ProviderProbeParams, deps: ProbeDeps): HttpTarget | string {
  const env = deps.env;
  const builtIn = BUILT_IN_PROVIDERS.find((provider) => provider.id === providerId);
  if (builtIn !== undefined) {
    if (builtIn.baseUrl === null) return `El proveedor ${JSON.stringify(providerId)} es nativo y no tiene endpoint HTTP`;
    const apiKey = (builtIn.apiKeyEnvVar === null ? '' : env[builtIn.apiKeyEnvVar] ?? '').trim();
    if (builtIn.apiKeyEnvVar !== null && apiKey.length === 0) {
      return `Falta la variable de entorno ${builtIn.apiKeyEnvVar}: sin ella no se puede consultar su catálogo.`;
    }
    return { baseUrl: builtIn.baseUrl, apiKey };
  }
  const baseUrl = (params.baseUrl ?? '').trim();
  if (baseUrl.length === 0) return `El proveedor ${JSON.stringify(providerId)} no declara URL base.`;
  return { baseUrl, apiKey: deps.readCustomApiKey(providerId).trim() };
}

// Salida de `agy models`: una linea por modelo, `id<TAB>etiqueta`. Las lineas sin tabulador (la
// cabecera "Fetching available models...", o cualquier aviso) se ignoran a proposito.
export function parseAgyModelsOutput(stdout: string): readonly ProviderModel[] {
  const models: ProviderModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf('\t');
    if (separator < 0) continue;
    const id = line.slice(0, separator).trim();
    if (id.length === 0) continue;
    const label = line.slice(separator + 1).trim();
    models.push({ id, label: label.length === 0 ? id : label });
  }
  return models;
}

const ModelsResponseSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

// Respuesta de GET /models (convencion OpenAI). Se valida en la frontera: un cuerpo que no encaja
// lanza con lo recibido en vez de colar una lista vacia como si el proveedor no tuviera modelos.
export function parseOpenAiModels(body: unknown): readonly ProviderModel[] {
  const parsed = ModelsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`la respuesta de /models no tiene la forma esperada ({data:[{id}]}): ${preview(body)}`);
  }
  // Etiqueta = id: un endpoint OpenAI-compatible no publica nombre legible.
  return parsed.data.data.map((model) => ({ id: model.id, label: model.id }));
}

function preview(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return (text ?? String(body)).slice(0, BODY_IN_ERROR_MAX);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Los reales, salvo el catalogo de Claude: vive en un store de main que este modulo no conoce.
export function defaultProbeDeps(
  loadClaudeModels: () => readonly ProviderModel[],
  readCustomApiKey: (providerId: string) => string,
): ProbeDeps {
  return {
    loadClaudeModels,
    readCustomApiKey,
    findClaudeBinary: findInstalledClaudeBinary,
    findAgyBinary: () => findAgyBinary(),
    findCodexBinary: () => findCodexBinary(),
    runCli: runCliCapturingStdout,
    fetchJson: fetchJsonBody,
    env: process.env,
  };
}

// `resolveClaudeBinary` NUNCA devuelve null: su ultimo recurso es confiar en el PATH. Para la UI eso no
// vale (hay que poder decir "no lo encuentro"), asi que aqui se comprueba que lo que devuelve sea una
// ruta que EXISTE; si es el nombre pelado del comando, se busca en el PATH con el mismo criterio.
function findInstalledClaudeBinary(): string | null {
  const resolved = resolveClaudeBinary();
  if (existsSync(resolved)) return resolved;
  return commandInPath(resolved) ? resolved : null;
}

function commandInPath(bin: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [bin], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
  return result.status === 0;
}

// Ejecuta un CLI y devuelve su stdout. Lanza (con el mensaje del propio proceso) si falla o si tarda
// mas de CLI_TIMEOUT_MS: el llamante lo convierte en el texto que ve el usuario.
function runCliCapturingStdout(bin: string, args: readonly string[]): Promise<string> {
  return execCapturingStdout(bin, args, { timeoutMs: CLI_TIMEOUT_MS });
}

// GET con timeout y, si hay credencial, cabecera Authorization. Un status != 2xx lanza con el codigo:
// un 401 y un 404 se arreglan de formas distintas y el usuario necesita saber cual le ha tocado.
async function fetchJsonBody(url: string, apiKey: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey.length > 0) headers['Authorization'] = `Bearer ${apiKey}`;
  const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} respondió ${response.status} ${response.statusText}`);
  }
  return await response.json();
}
