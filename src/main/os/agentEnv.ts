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
  // `OPENAI_API_KEY` sigue sirviendo al proveedor de serie `openai` del gateway, que la lee del entorno
  // de MAIN (process.env), no del hijo: borrarla aqui no le quita nada.
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
] as const;

// Devuelve una copia de `baseEnv` sin las variables prohibidas. No muta la entrada: quien llama suele
// pasar `process.env` y mutarlo afectaria al proceso main entero.
//
// Se aplica ANTES de que el llamante ponga las suyas, a proposito: `gatewayAdapter` fija
// `ANTHROPIC_BASE_URL` (a 127.0.0.1) y `ANTHROPIC_API_KEY` (un ticket `sk-mage-<sessionId>`, no una
// credencial de proveedor) DESPUES de llamar aqui, y debe poder hacerlo. Es la unica excepcion al
// invariante y por eso esta escrita.
export function scrubAgentEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of BLOCKED_ENV_VARS) delete env[name];
  return env;
}

// Exportada solo para que el test pueda comprobar la lista sin duplicarla.
export const BLOCKED_AGENT_ENV_VARS: readonly string[] = BLOCKED_ENV_VARS;
