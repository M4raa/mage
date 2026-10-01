// Catalogo de proveedores (E2). Hay dos clases, y la diferencia es de DATOS, no de codigo:
//   - de serie (`BUILT_IN_PROVIDERS`): los de motor NATIVO, cada uno con su CLI —`claude` (habla directo
//     con Anthropic), `agy` (Antigravity, que es EL CLI DE GOOGLE: Gemini no tiene uno propio, E3) y
//     `codex` (el de OpenAI, sobre `codex app-server`, sin verificar). Suscripcion o clave de API es cosa
//     de la CUENTA, no del proveedor (grupo E).
//   - del usuario (`AppSettings.customProviders`): CUALQUIER endpoint compatible con la API de OpenAI
//     —runtime local (Ollama, LM Studio) o remoto— con su URL base, sus modelos y una api key opcional.
//     Los ejecuta el runtime propio de Mage (P-032): anadir uno NO requiere codigo nuevo.
//
// `PROVIDER_TEMPLATES` son solo valores PREFIJADOS para el formulario de "anadir proveedor": Mage no
// asume que el usuario tenga ninguna IA local instalada, asi que de serie no existe ninguna entrada
// local (decision del usuario, ROADMAP E2). Cambiar host/puerto es editar su proveedor, no el codigo.

export interface ProviderModel {
  readonly id: string; // id que se manda al proveedor (--model y payload OpenAI)
  readonly label: string; // texto visible en los selectores
}

// Proveedor configurado por el usuario. `id` lo genera Mage (prefijo CUSTOM_PROVIDER_ID_PREFIX) para
// que nunca colisione con uno de serie; el usuario no lo escribe.
// Su api key NO vive aqui: esta cifrada en la boveda de main (`SecretStore`) y el renderer solo sabe si
// existe (`hasApiKey`). Sin clave = sin autenticacion (lo normal en runtimes locales): no se manda
// cabecera Authorization.
export interface CustomProvider {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly hasApiKey: boolean;
  readonly models: readonly ProviderModel[];
  // Ventana de contexto del modelo y si admite herramientas, si el usuario los fija (o los rellena
  // «Probar conexión»). Ausentes = los pregunta el runtime al servidor (P-032 §4.7).
  readonly contextWindow?: number;
  readonly supportsTools?: boolean;
}

// Proveedor de serie: siempre un CLI nativo.
export interface BuiltInProvider {
  readonly id: string;
  readonly label: string;
  readonly models: readonly ProviderModel[];
}

// Proveedores de serie que se RETIRARON con el gateway (P-032 R6): `openai` y `gemini` por clave de
// API iban por el CLI de Claude detras de un proxy. Sus cuentas son ahora de codex y de agy (grupo E).
// Una pestaña guardada con uno de ellos se reabre con Claude (`restoreTabs`).
export const RETIRED_PROVIDER_IDS: readonly string[] = ['openai', 'gemini'];

// Id del proveedor `agy` (E3). Constante porque lo miran main (fabrica de adapters), el renderer (el
// aviso de permisos) y los tests: un literal repetido en cinco sitios es la forma de que un dia solo
// se cambien cuatro.
export const AGY_PROVIDER_ID = 'agy';

// Id del proveedor `codex` (CLI de OpenAI). Mismo motivo que el de `agy`: lo miran el sondeo, el
// catalogo y los tests.
export const CODEX_PROVIDER_ID = 'codex';

// Codex corre sobre `codex app-server` (JSON-RPC por stdio), que SI tiene puente de permisos
// (`item/*/requestApproval`) y catalogo de modelos (`model/list`). Su adapter esta escrito desde el
// esquema que genera `codex app-server generate-json-schema` y lo medido SIN cuenta (codex-cli 0.144.4,
// `spike/codex-spike.mjs --app-server`): un turno real no se ha podido medir. La UI lo dice con este texto.
export const UNVERIFIED_PROVIDER_IDS: readonly string[] = [CODEX_PROVIDER_ID];
export const UNVERIFIED_PROVIDER_NOTE =
  'Sin verificar: Mage habla con Codex según su documentación y su esquema, pero aún no se ha probado ' +
  'un turno con una cuenta real.';

export function isUnverifiedProvider(providerId: string): boolean {
  return UNVERIFIED_PROVIDER_IDS.includes(providerId);
}

// Proveedores cuyo CLI NO tiene puente de permisos y por tanto AUTO-APRUEBAN toda tool.
//   - `agy` 1.2.14: no existe `--permission-prompt-tool`, y `control_request`/`control_response` por
//     stdin estan reservados («not supported yet»). Con `--add-dir` las escrituras se aplican sin
//     preguntar (en sus tres modos, medido) y los comandos se DENIEGAN en silencio salvo regla en su
//     configuracion.
// Eso rompe la decision nº 2 del proyecto (dialogos de permiso propios) solo para este proveedor, asi
// que la UI tiene la obligacion de decirlo donde no se pueda pasar por alto.
export const AUTO_APPROVED_PROVIDER_IDS: readonly string[] = [AGY_PROVIDER_ID];

// Texto UNICO del aviso (no se duplica por componente: si cambia, cambia en todos a la vez).
export const NO_PERMISSION_CONTROL_WARNING =
  'Sin control de permisos: el agente crea y modifica ficheros SIN preguntar dentro de la carpeta del ' +
  'proyecto, y agy deniega los comandos de terminal salvo los que permitas al empezar la conversación. ' +
  'Mage no puede preguntarte a mitad de turno (el CLI de agy no ofrece puente de permisos), así que esta ' +
  'pestaña no pasa por los diálogos de permiso de Mage.';

// Niveles de `--effort` de `agy`, medidos en 1.2.14 (`--help`: low|medium|high|max). Un solo sitio: lo
// usan su adapter (main) y los selectores (renderer).
export const AGY_EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'max'];

// ¿Corre este proveedor en el runtime propio de Mage (P-032)? Los del usuario (endpoints
// OpenAI-compatibles, locales o remotos): no tienen CLI. Los de serie con CLI nunca.
export function runsOnMageRuntime(providerId: string): boolean {
  return providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX);
}

// Modos de permiso del runtime propio (§8.1 D9 de P-032): los cinco, con un Auto propio como el preset de
// Codex (escribir y ejecutar dentro del workspace sin preguntar; preguntar fuera y para red).
export const RUNTIME_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;
export type RuntimePermissionMode = (typeof RUNTIME_PERMISSION_MODES)[number];

// ¿Las sesiones de este proveedor auto-aprueban las tools? Lo consultan la barra de prompt, el estado
// vacio de la conversacion y el dialogo de nueva pestana.
export function isAutoApprovedProvider(providerId: string): boolean {
  return AUTO_APPROVED_PROVIDER_IDS.includes(providerId);
}

// ¿Deja este proveedor una transcripcion en el formato del CLI de Claude Code, que Mage sabe releer?
// La escribe ese CLI (`claude`) y, en el mismo formato, el runtime propio (los del usuario, P-032 R4,
// en `userData/runtime`). `agy` y `codex` no: llevan su propio historial en su carpeta, en formato
// propio. Sin esta pregunta, el Inspector intentaria leer un fichero que no existe y pintaria un error
// falso en cada pestana de `agy`.
// ponytail: v1 se limita a NO pedirla. Techo: esas pestanas no tienen panel de logs ni reconstruccion
// del hilo al reabrirlas; se sube leyendo ~/.gemini/antigravity-cli/conversations (hay un .db/.pb por
// conversacion) y traduciendolo al modelo de transcripcion de Mage.
export function writesClaudeTranscript(providerId: string): boolean {
  return providerId !== AGY_PROVIDER_ID && providerId !== CODEX_PROVIDER_ID;
}

export const BUILT_IN_PROVIDERS: readonly BuiltInProvider[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    // Los ids son ALIAS del CLI (`sonnet`, `opus`, `haiku`): apuntan siempre a la ultima version de esa
    // familia, y por eso no se ponen ids con version — quedarian clavados en un modelo viejo. La
    // VERSION si va en la etiqueta, que era lo unico que faltaba (reporte del usuario: "la lista de
    // modelos no muestra la version"): el resto de proveedores ya la llevaban y solo Claude no.
    //
    // Esta lista es la RESERVA (P-026 2.4). Era falso que el CLI no publicara su catalogo: lo manda en la
    // respuesta a `initialize` (medido en 2.1.283, 11 modelos por cuenta), y Mage lo sondea al arrancar
    // y lo cachea por cuenta. Esto solo se ve antes del primer sondeo, o si el CLI no contesta. Sin
    // variantes `[1m]`: el 1M es ya el contexto de todos (usuario, 2026-09-26).
    //
    // No hace falta que este todo: `modelOptionsForProvider` conserva SIEMPRE el modelo actual de la
    // pestaña aunque no figure, asi que un id escrito a mano o arrastrado de otra version sigue
    // funcionando y no desaparece del selector.
    models: [
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'opus', label: 'Opus 5.5' },
      { id: 'haiku', label: 'Haiku 4.5' },
      // Fable va con su id COMPLETO porque no tiene alias corto, al contrario que los tres de arriba.
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    ],
  },
  {
    // Motor NATIVO nº 2 (E3): el CLI `agy` de Antigravity en `--output-format stream-json`, que
    // consume la SUSCRIPCION de Google con su propio login OAuth (nada de GEMINI_API_KEY, que
    // facturaria la API). Es un CLI nativo.
    // Modelos MEDIDOS con `agy models` contra la cuenta real (2026-09-18), en su mismo orden. Esta lista
    // es solo el RESPALDO de la seccion "Proveedores y modelos", que sondea el CLI en vivo: cuando se
    // pudo preguntar manda lo que responda `agy models`, no esto. Aun asi se mantiene al dia porque es
    // lo que se ofrece sin `agy` instalado o sin conexion (y estuvo un mes desfasada: la cuenta ya
    // ofrecia Gemini 3.8 y 3.7 cuando aqui seguian el 3.6 y un 3.5 que ya no existe).
    id: AGY_PROVIDER_ID,
    label: 'Antigravity · el CLI de Google (agy) · sin permisos',
    models: [
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
      { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
      { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
      { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
      { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
      { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
      { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
      { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
    ],
  },
  {
    // Motor NATIVO nº 3: el CLI `codex` de OpenAI sobre `codex app-server` (sin verificar con cuenta).
    // El catalogo SI es preguntable: `model/list` responde sin cuenta (medido el 2026-10-01 contra
    // codex-cli 0.144.4) y la sesion lo pide al arrancar. Esta lista es la RESERVA: lo que contesto ese
    // `model/list`, en su orden y sin los ocultos.
    id: CODEX_PROVIDER_ID,
    label: 'Codex (OpenAI) · sin verificar',
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
    ],
  },
];

// Plantilla del formulario de "anadir proveedor": los runtimes locales habituales con su puerto por
// defecto y unos modelos de ejemplo. Todo editable antes de guardar (host remoto, otro puerto, etc.).
export interface ProviderTemplate {
  readonly label: string;
  readonly baseUrl: string;
  readonly modelIds: readonly string[];
}

export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', modelIds: ['llama3', 'mistral', 'qwen2.5-coder'] },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', modelIds: ['local-model'] },
];

// Prefijo de los ids generados para proveedores del usuario: garantiza que jamas colisionen con un id
// de serie (que no lo lleva) sin tener que validar contra la lista.
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom:';

const CHAT_COMPLETIONS_PATH = '/chat/completions';
const MODELS_PATH = '/models';
const DEFAULT_VERSION_PATH = '/v1';

// URL final del endpoint de chat a partir de la URL base de un proveedor. Vive en `shared` a proposito:
// la usan el runtime propio (para hablar con el servidor) y la validacion del formulario, asi lo que la
// UI acepta es exactamente lo que el runtime podra llamar. Lanza Error con el valor recibido si no sirve.
export function chatCompletionsUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, CHAT_COMPLETIONS_PATH);
}

// URL del catalogo de modelos del mismo proveedor (GET, convencion OpenAI). La usa el sondeo de
// Configuracion para listar los modelos que el endpoint ofrece DE VERDAD en vez de los tecleados.
export function modelsUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, MODELS_PATH);
}

// Normaliza la URL base y le pega la ruta pedida. Guard clauses primero: vacia, no parseable o con un
// protocolo que no es http(s) lanzan con el valor recibido (el formulario pinta ese mensaje tal cual).
function endpointUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) throw new Error('La URL base del proveedor esta vacia');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`URL base del proveedor no valida: ${JSON.stringify(baseUrl)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`La URL base del proveedor debe ser http o https: ${JSON.stringify(baseUrl)}`);
  }
  url.search = '';
  url.hash = '';
  url.pathname = `${versionPath(url.pathname)}${path}`;
  return url.toString();
}

// ponytail: si la URL base no trae ruta se asume `/v1` (convencion OpenAI, cubre "host:puerto" a
// secas); una ruta explicita se respeta tal cual, asi el `/v1beta/openai` de Gemini no se rompe. Si el
// usuario pego la URL ENTERA hasta /chat/completions se recorta, para poder colgar tambien /models de
// la misma raiz. Techo: un endpoint con ruta de version rara Y sin indicarla falla.
function versionPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  if (path.endsWith(CHAT_COMPLETIONS_PATH)) return path.slice(0, -CHAT_COMPLETIONS_PATH.length);
  return path.length === 0 ? DEFAULT_VERSION_PATH : path;
}
