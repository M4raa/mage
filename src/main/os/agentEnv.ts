// Saneado del entorno que hereda un proceso hijo de agente (B2).
//
// POR QUE EXISTE: el invariante numero uno del proyecto es que los turnos se facturan a la
// SUSCRIPCION (login OAuth), nunca a la API. Hasta ahora ese invariante estaba escrito en seis sitios
// distintos —los seis que lanzan un hijo— y en los seis se borraba UNA sola variable,
// `ANTHROPIC_API_KEY`. Eso deja dos agujeros reales, ninguno hipotetico:
//
//   1. FACTURACION. Con `ANTHROPIC_AUTH_TOKEN` exportado en el entorno del usuario (lo pone cualquier
//      montaje con LiteLLM o un proxy corporativo), el CLI lo prefiere, desactiva OAuth y TODOS los
//      turnos pasan a facturarse a la API.
//   2. EXFILTRACION. Con `ANTHROPIC_BASE_URL` apuntando a un host ajeno, el CLI mantiene OAuth y
//      manda ahi el Bearer de la suscripcion.
//
// LISTA NEGRA, no blanca (decision A3 de la auditoria, tomada por el usuario). Una lista blanca
// cerraria el agujero para siempre, pero cualquier cosa que el entorno necesite —proxy corporativo,
// NODE_OPTIONS, locale, rutas de certificados— dejaria de llegar al CLI, y eso se descubre a base de
// que algo se rompa. El precio de la negra esta dicho en voz alta: si el CLI añade mañana otra
// variable de credencial, hay que acordarse de añadirla AQUI — pero ahora "aqui" es un solo sitio.

// Variables que NUNCA deben llegar al hijo. Todas son credenciales o redirecciones de endpoint.
const BLOCKED_ENV_VARS = [
  // Anthropic: clave de API, token de auth alternativo y redireccion de endpoint.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  // Claude Code: token OAuth inyectado y sus backends alternativos, que cambian a quien se factura.
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  // Otros proveedores, para los adapters que no son Claude (agy usa Gemini).
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  // OpenAI: `codex` lee las dos del entorno y con cualquiera factura la API en vez de la cuenta.
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
] as const;

// Devuelve una copia de `baseEnv` sin las variables prohibidas. No muta la entrada: quien llama suele
// pasar `process.env` y mutarlo afectaria al proceso main entero.
//
// Se aplica ANTES de que el llamante ponga las suyas, a proposito. TODO hijo pasa por aqui: los CLI y
// los comandos que lanza el runtime propio (`Bash`, P-032). La excepcion, escrita porque es la unica:
//   (grupo E) Una cuenta POR CLAVE DE API recibe SU clave, y solo el hijo de esa cuenta: el adapter
//      de su CLI la pone despues del saneado, leida de la boveda de main — `claudeAdapter`
//      `ANTHROPIC_API_KEY`, `agyAdapter` `GEMINI_API_KEY` y `codexAdapter` `MAGE_CODEX_API_KEY` (la de un
//      proveedor propio con `env_key`: el app-server no lee `CODEX_API_KEY`, medido en 0.144.4). Una
//      cuenta de suscripcion no recibe ninguna, y una clave exportada en el entorno del usuario sigue
//      sin llegar a ningun hijo.
//   (T6, solo pruebas) `MAGE_TEST_ANTHROPIC_BASE_URL` redirige a un servidor Messages FALSO local el hijo
//      de una cuenta de Claude POR CLAVE DE API, y solo con la app SIN empaquetar. Una cuenta de
//      suscripcion nunca la recibe, así que el token OAuth nunca sale hacia ese servidor. Con la app
//      empaquetada se ignora con aviso. La decide `decideTestAnthropicBaseUrl`; `ANTHROPIC_BASE_URL` del
//      entorno del usuario sigue sin llegar a ningun hijo.
export function scrubAgentEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of BLOCKED_ENV_VARS) delete env[name];
  return env;
}

// T6: variable de PRUEBAS que apunta el hijo de una cuenta de API a un servidor Messages falso local.
export const TEST_ANTHROPIC_BASE_URL_ENV = 'MAGE_TEST_ANTHROPIC_BASE_URL';

export type TestEndpointDecision =
  | { readonly kind: 'none' } // variable ausente o vacia
  | { readonly kind: 'use'; readonly url: string }
  | { readonly kind: 'ignored'; readonly reason: 'packaged' | 'not_loopback' | 'not_api_account' };

const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

// Decide si el hijo recibe la URL de pruebas. Las guardas van en este orden a proposito: lo primero que
// falla manda, y la ultima (cuenta de API) es la que impide que un token OAuth salga hacia el servidor falso.
export function decideTestAnthropicBaseUrl(input: {
  readonly value: string | undefined;
  readonly isPackaged: boolean;
  readonly isApiKeyAccount: boolean;
}): TestEndpointDecision {
  const raw = input.value?.trim() ?? '';
  if (raw.length === 0) return { kind: 'none' };
  if (input.isPackaged) return { kind: 'ignored', reason: 'packaged' };
  const url = parseLoopbackHttpUrl(raw);
  if (url === null) return { kind: 'ignored', reason: 'not_loopback' };
  if (!input.isApiKeyAccount) return { kind: 'ignored', reason: 'not_api_account' };
  return { kind: 'use', url: url.origin };
}

function parseLoopbackHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(url.hostname) ? url : null;
  } catch {
    // No es una URL: no es un fallo tragado, la decision lo devuelve como `not_loopback`.
    return null;
  }
}

// Exportada solo para que el test pueda comprobar la lista sin duplicarla.
export const BLOCKED_AGENT_ENV_VARS: readonly string[] = BLOCKED_ENV_VARS;
