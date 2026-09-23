// Mage — Spike M1.0 del motor.
// Objetivo: despejar el riesgo #1 validando el protocolo stream-json del CLI real de Claude Code
// en modo headless. Prueba los 4 criterios del DoD (ver el brief del proyecto):
//   1. Llegan stream_event / deltas (efecto typing).
//   2. Round-trip de permisos (control_request can_use_tool -> control_response allow).
//   3. Delta en /api/oauth/usage => consume suscripcion; ANTHROPIC_API_KEY ausente en el hijo.
//   4. Sesion multiturno con --session-id fijo (2+ mensajes en el mismo proceso).
//
// NO es codigo de produccion: es un prototipo para confirmar el contrato antes de invertir en UI.
// Identificadores en ingles, comentarios en castellano (estandar del proyecto).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Configuracion (sin magic numbers dispersos) ---------------------------------------------

const CONFIG = {
  // Binario del CLI. En Windows resolvemos el .exe directo (los shims .cmd no arrancan con spawn
  // directo). Este resolver minimo cubre el spike; en Mage vive en ClaudeBinaryResolver.
  claudeBin: resolveClaudeBinary(),
  // Cuenta a usar: fija CLAUDE_CONFIG_DIR en el env del hijo (cross-platform, no depende del perfil).
  accountDir: process.env.MAGE_ACCOUNT_DIR ?? path.join(os.homedir(), '.claude-p'),
  model: process.env.MAGE_MODEL ?? 'haiku', // barato: el spike no necesita capacidad, solo protocolo
  usageEndpoint: 'https://api.anthropic.com/api/oauth/usage',
  cliVersion: '2.1.205', // para el User-Agent del endpoint de uso (imprescindible o 429)
  turnTimeoutMs: 120_000,
};

// Fichero que el agente creara (fuerza un permiso Write); se limpia al final.
const ARTIFACT_NAME = 'mage-spike-artifact.txt';
const ARTIFACT_CONTENT = 'hello-from-mage-spike';

// Dos turnos para validar multiturno; el segundo referencia al primero (memoria de sesion).
// El turno 1 usa Write: en modo de permisos 'default' SIEMPRE pide confirmacion (a diferencia de
// 'echo', que la heuristica de comandos seguros auto-aprueba). Asi se ejercita el round-trip.
const PROMPTS = [
  `Usa la herramienta Write para crear el fichero ${ARTIFACT_NAME} en el directorio actual ` +
    `con exactamente este contenido: ${ARTIFACT_CONTENT}`,
  `Lee el fichero ${ARTIFACT_NAME} y dime su contenido textual en una sola frase.`,
];

// --- Resolucion del binario (mini ClaudeBinaryResolver) ---------------------------------------

function resolveClaudeBinary() {
  const override = process.env.MAGE_CLAUDE_BIN;
  if (override) return override;
  // Ubicacion habitual del instalador nativo en Windows.
  const winLocal = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform === 'win32' && fs.existsSync(winLocal)) return winLocal;
  // Fallback: confiar en el PATH (POSIX o shim en Windows -> requeriria shell:true).
  return 'claude';
}

// --- Lectura de token (frontera: validar, nunca loguear el token) -----------------------------

// Lee <CONFIG_DIR>/.credentials.json -> claudeAiOauth.accessToken. Se relee en cada consulta
// (el CLI refresca el fichero al usarse); nunca se cachea el token en memoria.
function readAccessToken(configDir) {
  const credPath = path.join(configDir, '.credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error(`No hay .credentials.json en la cuenta: ${configDir} (ejecuta 'claude login')`);
  }
  const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const token = parsed?.claudeAiOauth?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`Token OAuth ausente o invalido en: ${credPath}`);
  }
  return token;
}

// --- Endpoint de uso (criterio #3: delta => suscripcion) --------------------------------------

async function fetchUsageSnapshot(configDir) {
  const token = readAccessToken(configDir);
  const res = await fetch(CONFIG.usageEndpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': `claude-code/${CONFIG.cliVersion}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Endpoint de uso respondio ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Resume las senales relevantes del snapshot de uso de forma tolerante al esquema:
//  - fiveHourUtil: % de la ventana de suscripcion de 5h (entero grueso, con lag).
//  - apiCreditsMinor: creditos de API gastados (spend.used) en unidades menores; 0 => no factura API.
function summarizeUsage(usage) {
  const util = usage?.five_hour?.utilization;
  const minor = usage?.spend?.used?.amount_minor;
  return {
    fiveHourUtil: typeof util === 'number' ? util : null,
    apiCreditsMinor: typeof minor === 'number' ? minor : null,
  };
}

// --- Escritura NDJSON a stdin del hijo --------------------------------------------------------

function writeLine(child, obj) {
  child.stdin.write(`${JSON.stringify(obj)}\n`);
}

// Mensaje de usuario (forma minima viable confirmada contra el fuente 2.1.88/2.1.205).
function sendUserMessage(child, text) {
  writeLine(child, {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null, // clave requerida, nullable; null en el hilo principal
  });
}

// Respuesta de permiso "allow". updatedInput es OBLIGATORIO; {} = usar el input original.
function answerAllow(child, requestId, toolUseId) {
  writeLine(child, {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: { behavior: 'allow', updatedInput: {}, toolUseID: toolUseId },
    },
  });
}

// --- Parser NDJSON de stdout ------------------------------------------------------------------

// Trocea el stream en lineas y entrega objetos JSON parseados. Devuelve el resto no terminado.
function makeLineParser(onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // El CLI garantiza NDJSON puro en stdout; una linea no-JSON es senal de problema.
        console.error(`[spike] linea de stdout no parseable: ${line.slice(0, 200)}`);
        continue;
      }
      onEvent(event);
    }
  };
}

// --- Enrutado de eventos ----------------------------------------------------------------------

// Estado observable del turno para el criterio de streaming.
const seen = { streamDeltas: 0, permissionRequests: 0, toolCalls: 0, rateLimitEvents: 0, rateLimitInfo: null };

function handleEvent(child, event, resolveTurn) {
  // Permisos: el CLI pregunta, respondemos allow (round-trip, criterio #2).
  if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
    seen.permissionRequests += 1;
    const { tool_name: toolName, tool_use_id: toolUseId } = event.request;
    console.log(`\n[permiso] can_use_tool -> ${toolName} (allow)`);
    answerAllow(child, event.request_id, toolUseId);
    return;
  }
  // Cancelacion de un permiso aun abierto: soltar el pendiente, no responder.
  if (event.type === 'control_cancel_request') {
    console.log(`[permiso] cancelado request_id=${event.request_id}`);
    return;
  }
  // Deltas de streaming (criterio #1): efecto typing.
  if (event.type === 'stream_event') {
    const delta = event.event?.delta?.text;
    if (typeof delta === 'string' && delta.length > 0) {
      seen.streamDeltas += 1;
      process.stdout.write(delta);
    }
    return;
  }
  // S3 de la Fase 9: la forma REAL de `rate_limit_event`. El fuente (spec) dice que se emite en CADA
  // cambio de estado, incluido `status: 'allowed'`, asi que un turno normal deberia traerlo sin
  // necesidad de agotar la suscripcion. Se guarda el primero ENTERO: hasta hoy normalize.ts lo
  // reconocia y tiraba el payload (`resetsAtMs: null`).
  if (event.type === 'rate_limit_event') {
    seen.rateLimitEvents += 1;
    if (seen.rateLimitInfo === null) seen.rateLimitInfo = event.rate_limit_info ?? null;
    console.log(`
[rate_limit] ${JSON.stringify(event.rate_limit_info ?? event)}`);
    return;
  }
  if (event.type === 'system' && event.subtype === 'init') {
    console.log(`[init] modelo=${event.model} sesion=${event.session_id} tools=${event.tools?.length ?? '?'}`);
    return;
  }
  if (event.type === 'assistant') {
    const blocks = event.message?.content ?? [];
    for (const b of blocks) if (b.type === 'tool_use') seen.toolCalls += 1;
    return;
  }
  // Fin de turno autoritativo (criterio #4 depende de detectarlo bien).
  if (event.type === 'result') {
    console.log(`\n[result] subtype=${event.subtype} cost_usd=${event.total_cost_usd ?? 'n/a'} turns=${event.num_turns ?? '?'}`);
    resolveTurn(event);
  }
}

// --- Ciclo de un turno ------------------------------------------------------------------------

function runTurn(child, parser, prompt, index) {
  return new Promise((resolve, reject) => {
    console.log(`\n===== TURNO ${index + 1} =====\n> ${prompt}\n`);
    const timer = setTimeout(
      () => reject(new Error(`Turno ${index + 1} sin 'result' tras ${CONFIG.turnTimeoutMs} ms`)),
      CONFIG.turnTimeoutMs,
    );
    parser.setTurnResolver((result) => {
      clearTimeout(timer);
      resolve(result);
    });
    sendUserMessage(child, prompt);
  });
}

// --- Orquestacion -----------------------------------------------------------------------------

async function main() {
  const sessionId = randomUUID();
  console.log('[spike] Motor de Mage — validacion de protocolo stream-json');
  console.log(`[spike] bin=${CONFIG.claudeBin}`);
  console.log(`[spike] cuenta=${CONFIG.accountDir} modelo=${CONFIG.model} session-id=${sessionId}`);

  // Criterio #3a: snapshot de uso ANTES.
  const before = summarizeUsage(await fetchUsageSnapshot(CONFIG.accountDir));
  console.log(`[uso] ANTES  util5h=${before.fiveHourUtil}% creditosAPI=${before.apiCreditsMinor}`);

  // Env del hijo: fijar CLAUDE_CONFIG_DIR y BORRAR ANTHROPIC_API_KEY (criterio #3b).
  const childEnv = { ...process.env, CLAUDE_CONFIG_DIR: CONFIG.accountDir };
  delete childEnv.ANTHROPIC_API_KEY;
  const apiKeyAbsent = !('ANTHROPIC_API_KEY' in childEnv);

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose', // OBLIGATORIO con --output-format stream-json
    '--permission-prompt-tool', 'stdio',
    '--include-partial-messages',
    '--session-id', sessionId,
    '--model', CONFIG.model,
  ];

  const child = spawn(CONFIG.claudeBin, args, {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  console.log(`[spike] hijo pid=${child.pid} ANTHROPIC_API_KEY-ausente-en-hijo=${apiKeyAbsent}`);

  // Pequeno truco para poder cambiar el resolver de turno entre mensajes.
  const parser = { setTurnResolver(fn) { this._resolve = fn; } };
  const feed = makeLineParser((event) => handleEvent(child, event, (r) => parser._resolve?.(r)));

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', feed);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => process.stderr.write(`[cli-stderr] ${d}`));

  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  try {
    // Criterio #4: dos turnos en la MISMA sesion/proceso.
    for (let i = 0; i < PROMPTS.length; i += 1) {
      await runTurn(child, parser, PROMPTS[i], i);
    }
  } finally {
    child.stdin.end(); // fin de input -> el CLI termina el proceso
  }

  const { code, signal } = await exited;
  console.log(`\n[spike] hijo salio code=${code} signal=${signal ?? 'none'}`);

  // Criterio #3a: snapshot de uso DESPUES (releyendo token, por si el CLI lo refresco).
  const after = summarizeUsage(await fetchUsageSnapshot(CONFIG.accountDir));
  console.log(`[uso] DESPUES util5h=${after.fiveHourUtil}% creditosAPI=${after.apiCreditsMinor}`);

  cleanupArtifact();
  printVerdict({ before, after, apiKeyAbsent, exitCode: code });
}

// Borra el fichero que el agente creo (no ensuciar el repo con artefactos del spike).
function cleanupArtifact() {
  const artifact = path.join(process.cwd(), ARTIFACT_NAME);
  if (fs.existsSync(artifact)) fs.rmSync(artifact);
}

// --- Veredicto de los 4 criterios -------------------------------------------------------------

function printVerdict({ before, after, apiKeyAbsent, exitCode }) {
  const utilDelta =
    typeof before.fiveHourUtil === 'number' && typeof after.fiveHourUtil === 'number'
      ? after.fiveHourUtil - before.fiveHourUtil
      : null;
  // Prueba robusta de "suscripcion, no API": sin API key en el hijo, endpoint OAuth alcanzable
  // (util5h es un numero valido) y CERO creditos de API gastados. El delta de util5h es solo
  // informativo: es un entero grueso con lag, no se mueve con una llamada pequena de haiku.
  // Se compara el DELTA, no el valor absoluto: una cuenta con gasto historico de Console (o con
  // creditos ya consumidos) tiene un `amount_minor` > 0 que no dice nada de ESTE turno. Con el
  // absoluto, el criterio daba FAIL en una cuenta sana y el invariante nº1 parecia roto (2026-09-14).
  const noApiCredits = before.apiCreditsMinor === after.apiCreditsMinor;
  const oauthReachable = typeof after.fiveHourUtil === 'number';
  const subscription = apiKeyAbsent && oauthReachable && noApiCredits;
  const criteria = [
    ['1. stream_event/deltas (typing)', seen.streamDeltas > 0, `${seen.streamDeltas} deltas`],
    ['2. round-trip de permisos', seen.permissionRequests > 0, `${seen.permissionRequests} permisos, ${seen.toolCalls} tool_use`],
    ['3. suscripcion (sin API key + OAuth + 0 creditos API)', subscription, `apiKeyAusente=${apiKeyAbsent} util5hDelta=${utilDelta} creditosAPI ${before.apiCreditsMinor}->${after.apiCreditsMinor}`],
    ['4. multiturno + salida limpia', exitCode === 0, `exit=${exitCode}`],
    ['5. rate_limit_event con payload (Fase 9 S3)', seen.rateLimitEvents > 0, describeRateLimit()],
  ];
  console.log('\n========== VEREDICTO DEL SPIKE ==========');
  for (const [label, ok, detail] of criteria) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
  }
  console.log('=========================================');
}

// Resume el primer `rate_limit_info` visto contra los campos que la spec del fuente declara. Lo que
// interesa a 9.3 es si llegan `utilization` y `resetsAt`: con ellos el stream puede ser la fuente
// primaria del panel de Uso y `RateLimitBanner` deja de adivinar.
function describeRateLimit() {
  if (seen.rateLimitEvents === 0) return 'ninguno en este turno';
  const info = seen.rateLimitInfo;
  if (info === null || typeof info !== 'object') return `${seen.rateLimitEvents} eventos, pero SIN rate_limit_info`;
  const campos = ['status', 'rateLimitType', 'utilization', 'resetsAt', 'overageStatus'];
  const presentes = campos.filter((campo) => info[campo] !== undefined);
  return `${seen.rateLimitEvents} eventos | campos: ${presentes.join(', ')} | ${JSON.stringify(info)}`;
}

main().catch((err) => {
  console.error(`\n[spike] ERROR: ${err.message}`);
  process.exit(1);
});
