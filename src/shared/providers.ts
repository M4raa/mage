// Catalogo de proveedores (E2). Hay dos clases, y la diferencia es de DATOS, no de codigo:
//   - de serie (`BUILT_IN_PROVIDERS`): los de motor NATIVO —`claude` (su CLI habla directo con
//     Anthropic) y `agy` (Antigravity, que es EL CLI DE GOOGLE: Gemini no tiene uno propio, E3)— y los
//     de nube cuyo endpoint y variable de entorno son fijos (`openai`, `gemini`), que van por el
//     gateway local Anthropic<->OpenAI. Ojo a las DOS entradas de Google: `agy` corre los modelos
//     Gemini con la SUSCRIPCION (login OAuth del propio CLI) y `gemini` los mismos con una CLAVE de
//     API facturada aparte. No son proveedores distintos: son dos caminos al mismo sitio.
//   - del usuario (`AppSettings.customProviders`): CUALQUIER endpoint compatible con la API de OpenAI
//     —runtime local (Ollama, LM Studio) o remoto— con su URL base, sus modelos y una api key opcional.
//     Anadir uno NO requiere codigo nuevo: el mismo adapter de gateway y el mismo resolutor sirven.
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
}

// Proveedor de serie. `baseUrl === null` marca el motor nativo (no pasa por el gateway).
// `apiKeyEnvVar` es la variable de entorno de la que se lee su credencial (obligatoria si no es null);
// la key vive SOLO en el proceso main y nunca se pasa al CLI hijo ni se loguea.
export interface BuiltInProvider {
  readonly id: string;
  readonly label: string;
  readonly models: readonly ProviderModel[];
  readonly baseUrl: string | null;
  readonly apiKeyEnvVar: string | null;
  // Alias de modelo: un id de modelo de Claude que arrastre la sesion se traduce al equivalente del
  // proveedor. Sin esto, una pestana creada con 'sonnet' que cambia a otro proveedor pide un modelo
  // que el upstream no conoce y responde 404 model_not_found.
  readonly modelAliases: Readonly<Record<string, string>>;
}

// Id del proveedor `agy` (E3). Constante porque lo miran main (fabrica de adapters), el renderer (el
// aviso de permisos) y los tests: un literal repetido en cinco sitios es la forma de que un dia solo
// se cambien cuatro.
export const AGY_PROVIDER_ID = 'agy';

// Id del proveedor `codex` (CLI de OpenAI). Mismo motivo que el de `agy`: lo miran el sondeo, el
// catalogo y los tests.
export const CODEX_PROVIDER_ID = 'codex';

// Proveedores que Mage DETECTA pero todavia no sabe EJECUTAR: les falta su `ProviderAdapter`. Se
// listan en Ajustes (con el motivo a la vista) y NO se ofrecen al abrir una conversacion — ofrecer
// algo que va a fallar al primer mensaje es peor que no ofrecerlo.
//
// Codex esta aqui por una razon concreta y reversible: su protocolo ENCAJA (`codex exec --json` da
// JSONL por stdout, y acepta `-C/--cd`, `--add-dir`, `-m/--model` y `codex exec resume`), pero el
// stream de eventos de un turno real no se ha podido MEDIR porque la maquina donde se añadio no tiene
// cuenta de Codex (`codex login status` -> "Not logged in"). Escribir el adapter desde el `--help` es
// exactamente lo que prohibe la skill `protocolo-cli`, y este proyecto ya lo pago dos veces. Con una
// cuenta se mide, se escribe el adapter y Codex sale de esta lista.
export const PROVIDERS_WITHOUT_ADAPTER: readonly string[] = [CODEX_PROVIDER_ID];

// ¿Puede Mage EJECUTAR este proveedor? Lo consultan los selectores de conversacion, que solo deben
// ofrecer lo que de verdad va a arrancar.
export function hasAdapter(providerId: string): boolean {
  return !PROVIDERS_WITHOUT_ADAPTER.includes(providerId);
}

// Proveedores cuyo CLI NO tiene puente de permisos y por tanto AUTO-APRUEBAN toda tool.
//   - `agy` 1.1.11: no existe `--permission-prompt-tool` ni ninguna peticion de permiso por stdout que
//     Mage pueda contestar, y con `--add-dir` las escrituras se aplican sin preguntar.
//   - `codex` 0.144.4 (medido el 2026-09-18): el oraculo de flags rechaza `--permission-prompt-tool`,
//     `--approval-mode` y `--ask-for-approval`; lo unico que ofrece es `--sandbox`
//     (read-only | workspace-write | danger-full-access), que es una politica ESTATICA, no un puente.
// Eso rompe la decision nº 2 del proyecto (dialogos de permiso propios) solo para estos proveedores,
// asi que la UI tiene la obligacion de decirlo donde no se pueda pasar por alto.
export const AUTO_APPROVED_PROVIDER_IDS: readonly string[] = [AGY_PROVIDER_ID, CODEX_PROVIDER_ID];

// Texto UNICO del aviso (no se duplica por componente: si cambia, cambia en todos a la vez).
export const NO_PERMISSION_CONTROL_WARNING =
  'Sin control de permisos: el agente crea y modifica ficheros SIN preguntar dentro de la carpeta del ' +
  'proyecto. Mage no puede interceptarlo (ni el CLI de agy ni el de Codex ofrecen ningún puente de ' +
  'permisos), así que esta pestaña no pasa por los diálogos de permiso de Mage.';

// ¿Las sesiones de este proveedor auto-aprueban las tools? Lo consultan la barra de prompt, el estado
// vacio de la conversacion y el dialogo de nueva pestana.
export function isAutoApprovedProvider(providerId: string): boolean {
  return AUTO_APPROVED_PROVIDER_IDS.includes(providerId);
}

// ¿Deja este proveedor una transcripcion en el CLAUDE_CONFIG_DIR de la cuenta? La escribe el CLI de
// Claude Code, asi que la tienen el proveedor nativo `claude` y TODOS los de gateway (su motor sigue
// siendo ese CLI). `agy` es el primero que no: lleva su propio historial en su carpeta, en formato
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
    baseUrl: null,
    apiKeyEnvVar: null,
    modelAliases: {},
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
    // facturaria la API). No pasa por el gateway: `baseUrl` null.
    // Modelos MEDIDOS con `agy models` contra la cuenta real (2026-09-18), en su mismo orden. Esta lista
    // es solo el RESPALDO de la seccion "Proveedores y modelos", que sondea el CLI en vivo: cuando se
    // pudo preguntar manda lo que responda `agy models`, no esto. Aun asi se mantiene al dia porque es
    // lo que se ofrece sin `agy` instalado o sin conexion (y estuvo un mes desfasada: la cuenta ya
    // ofrecia Gemini 3.8 y 3.7 cuando aqui seguian el 3.6 y un 3.5 que ya no existe).
    id: AGY_PROVIDER_ID,
    label: 'Antigravity · el CLI de Google (agy) · sin permisos',
    baseUrl: null,
    apiKeyEnvVar: null,
    // Los alias son un concepto del GATEWAY (traducir un modelo de Claude arrastrado por la sesion al
    // del upstream). Un proveedor nativo no pasa por ahi, asi que no tiene ninguno.
    modelAliases: {},
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
    // Motor NATIVO nº 3: el CLI `codex` de OpenAI. MEDIDO el 2026-09-18 contra codex-cli 0.144.4:
    // `codex exec --json` imprime eventos JSONL por stdout y acepta `-C/--cd`, `--add-dir`,
    // `-m/--model` y `codex exec resume`, asi que el protocolo encaja con el motor de Mage.
    //
    // DETECTADO PERO AUN NO EJECUTABLE (ver PROVIDERS_WITHOUT_ADAPTER): falta medir el stream de
    // eventos de un turno real, y para eso hace falta una cuenta de Codex.
    //
    // Sin catalogo preguntable —no hay ningun comando que liste modelos, igual que en Claude—, asi que
    // esta lista es la CURADA y se dice en la UI. Los ids son los que acepta `-m/--model`.
    id: CODEX_PROVIDER_ID,
    label: 'Codex (OpenAI) · sin permisos',
    baseUrl: null,
    apiKeyEnvVar: null,
    modelAliases: {},
    models: [
      { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI · API (clave propia)',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    modelAliases: { sonnet: 'gpt-4o', haiku: 'gpt-4o-mini' },
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o-mini' },
      { id: 'o1', label: 'o1' },
      { id: 'o1-mini', label: 'o1-mini' },
    ],
  },
  {
    id: 'gemini',
    // API, NO un CLI: Gemini no tiene uno propio — el CLI de Google es Antigravity (`agy`), que corre
    // estos mismos modelos con la SUSCRIPCION en vez de con una clave de API. Se deja el nombre del
    // camino en la etiqueta para que las dos entradas de Google no parezcan proveedores distintos.
    label: 'Gemini · API de Google (clave propia)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    modelAliases: { sonnet: 'gemini-2.5-flash', haiku: 'gemini-1.5-flash', opus: 'gemini-2.5-pro' },
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
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
  // Los dos de NUBE tambien son plantillas desde el 2026-09-18. Antes eran entradas fijas del catalogo
  // y salian SIEMPRE en Ajustes, estuvieran configuradas o no; ahora la seccion solo lista lo que se
  // puede usar, asi que la via para darlos de alta es esta — con su URL ya puesta y pidiendo la clave,
  // que es justo lo que les falta. Siguen existiendo en BUILT_IN_PROVIDERS para quien ya los usa con
  // su variable de entorno: en ese caso el sondeo los encuentra y la seccion los muestra sola.
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelIds: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  },
  {
    // La API de Google. Su CLI es Antigravity (`agy`), que es otra entrada y va por suscripcion.
    label: 'Gemini (API)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelIds: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  },
];

// Prefijo de los ids generados para proveedores del usuario: garantiza que jamas colisionen con un id
// de serie (que no lo lleva) sin tener que validar contra la lista.
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom:';

// Como se da de alta un proveedor (P-028, punto 41), tal como lo ve el renderer. Solo cadenas
// descriptivas: el dialogo «Añadir cuenta» nunca pide ni muestra claves.
export type ProviderAuthKind = 'cli-oauth' | 'api-key' | 'external';

export interface ProviderAuthSummary {
  readonly providerId: string;
  readonly label: string;
  readonly kind: ProviderAuthKind;
  readonly reason: string;
}

const CHAT_COMPLETIONS_PATH = '/chat/completions';
const MODELS_PATH = '/models';
const DEFAULT_VERSION_PATH = '/v1';

// URL final del endpoint de chat a partir de la URL base de un proveedor. Vive en `shared` a proposito:
// la usan el gateway (para hablar con el upstream) y la validacion del formulario, asi lo que la UI
// acepta es exactamente lo que el gateway podra llamar. Lanza Error con el valor recibido si no sirve.
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
