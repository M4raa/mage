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
import zlib from 'node:zlib';

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

// --- S3 de P-026: imagenes intercaladas con el texto (un turno de haiku) ----------------------
// Uso: node spike/engine-spike.mjs --images   (cuenta ~/.claude salvo MAGE_ACCOUNT_DIR)
// Mide si el CLI respeta el orden [texto, img, texto, img, texto] de un mensaje de usuario: se le
// pregunta por la segunda imagen y se lee el .jsonl para ver en que orden la guardo. El transcript es
// de usar y tirar: se borra al acabar, para no dejar una conversacion de prueba en el historial.

// PNG de color liso generado en memoria: firma + IHDR + IDAT (deflate) + IEND, cada chunk con su CRC.
function solidPng(size, [r, g, b]) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, sin entrelazado
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

const IMAGE_SPIKE = {
  accountDir: process.env.MAGE_ACCOUNT_DIR ?? path.join(os.homedir(), '.claude'),
  pngSize: 8,
  question: '¿De qué color es la Imagen 2? Responde una palabra.',
};

function imageBlock(rgb) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: solidPng(IMAGE_SPIKE.pngSize, rgb).toString('base64') } };
}

// Ruta del transcript: <config>/projects/<cwd con todo lo no alfanumerico como '-'>/<session>.jsonl.
function transcriptPath(configDir, sessionId) {
  const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
  return path.join(configDir, 'projects', slug, `${sessionId}.jsonl`);
}

// Orden de los bloques del primer mensaje de usuario del transcript, p. ej. ['text:Imagen 1:', 'image', ...].
function userBlockOrder(file) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = JSON.parse(line);
    const content = entry.type === 'user' ? entry.message?.content : null;
    if (!Array.isArray(content)) continue;
    return content.map((block) => (block.type === 'text' ? `text:${block.text}` : block.type));
  }
  return [];
}

async function imageOrderSpike() {
  const sessionId = randomUUID();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: IMAGE_SPIKE.accountDir };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete env[name];
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio', '--session-id', sessionId, '--model', 'haiku'];
  const child = spawn(CONFIG.claudeBin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let answer = '';
  let result = null;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sin result en ${CONFIG.turnTimeoutMs} ms`)), CONFIG.turnTimeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', makeLineParser((event) => {
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) if (block.type === 'text') answer += block.text;
      }
      if (event.type === 'result') {
        result = event;
        clearTimeout(timer);
        resolve();
      }
    }));
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => process.stderr.write(`[cli-stderr] ${d}`));
  const content = [
    { type: 'text', text: 'Imagen 1:' }, imageBlock([255, 0, 0]),
    { type: 'text', text: 'Imagen 2:' }, imageBlock([0, 0, 255]),
    { type: 'text', text: IMAGE_SPIKE.question },
  ];
  writeLine(child, { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
  try {
    await done;
  } finally {
    child.stdin.end();
    child.kill();
  }
  const file = transcriptPath(IMAGE_SPIKE.accountDir, sessionId);
  console.log(`[S3] result=${result?.subtype ?? 'ninguno'} respuesta=${JSON.stringify(answer.trim())}`);
  console.log(`[S3] dice azul: ${/azul|blue/i.test(answer) ? 'SI' : 'NO'}`);
  console.log(`[S3] orden en el transcript: ${JSON.stringify(userBlockOrder(file))}`);
  if (fs.existsSync(file)) fs.rmSync(file);
  console.log(`[S3] transcript de prueba borrado: ${!fs.existsSync(file)}`);
}

// --- P-026 1.6: que emite `/rename` en headless (sin turno) ------------------------------------
// Uso: node spike/engine-spike.mjs --rename. Manda SOLO "/rename <titulo>" a una sesion nueva e
// imprime el tipo de cada evento de stdout, y luego que dejo en el .jsonl. Borra el transcript.
async function renameSpike() {
  const sessionId = randomUUID();
  const title = 'mage-rename-spike';
  const env = { ...process.env, CLAUDE_CONFIG_DIR: IMAGE_SPIKE.accountDir };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete env[name];
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio', '--session-id', sessionId, '--model', 'haiku'];
  const child = spawn(CONFIG.claudeBin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const events = [];
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', makeLineParser((event) => {
      const content = event.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => b.text ?? b.type).join('|') : '';
      events.push(`${event.type}/${event.subtype ?? ''}${text ? ` ${JSON.stringify(text.slice(0, 120))}` : ''}${event.type === 'result' ? ` cost=${event.total_cost_usd} turns=${event.num_turns} usage=${JSON.stringify(event.usage ?? null).slice(0, 80)}` : ''}`);
      // P-026 2.6: la FORMA de `skills`, `plugins` y `plugin_errors` del init (llega sin coste con `/rename`).
      if (event.type === 'system' && event.subtype === 'init') {
        const shape = (value) => (Array.isArray(value) ? `array(${value.length}) ${JSON.stringify(value.slice(0, 2)).slice(0, 200)}` : typeof value);
        console.log(`[init] claves=${JSON.stringify(Object.keys(event))}`);
        for (const key of ['skills', 'plugins', 'plugin_errors', 'permissionMode']) console.log(`[init] ${key}: ${shape(event[key])}${typeof event[key] === 'string' ? ` ${event[key]}` : ''}`);
      }
      if (event.type === 'result') { clearTimeout(timer); resolve(); }
    }));
  });
  writeLine(child, { type: 'user', message: { role: 'user', content: `/rename ${title}` }, parent_tool_use_id: null });
  await done;
  child.stdin.end();
  child.kill();
  console.log(`[rename] eventos de stdout:\n  ${events.join('\n  ')}`);
  const file = transcriptPath(IMAGE_SPIKE.accountDir, sessionId);
  if (!fs.existsSync(file)) {
    console.log('[rename] sin transcript');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  console.log(`[rename] transcript:\n  ${lines.map((o) => `${o.type}/${o.subtype ?? ''} meta=${o.isMeta === true} ${JSON.stringify(String(o.message?.content ?? o.content ?? o.customTitle ?? o.agentName ?? '').slice(0, 100))}`).join('\n  ')}`);
  fs.rmSync(file);
}

// --- P-026 3.4: los pasos de un SUBAGENTE en el stream (un turno de haiku) -----------------------
// Uso: node spike/engine-spike.mjs --subagent. Pide al agente que lance UN subagente que haga una sola
// herramienta, auto-permite y cuenta, por evento, su `parent_tool_use_id`: es lo que permitiria atribuir
// cada paso a su subagente. Borra el transcript al acabar.
async function subagentSpike() {
  const sessionId = randomUUID();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: IMAGE_SPIKE.accountDir };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete env[name];
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--session-id', sessionId, '--model', 'haiku'];
  const child = spawn(CONFIG.claudeBin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const rows = [];
  const streamCounts = new Map();
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, CONFIG.turnTimeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', makeLineParser((event) => {
      if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
        answerAllow(child, event.request_id, event.request.tool_use_id);
        rows.push(`permiso ${event.request.tool_name} parent=${event.request.parent_tool_use_id ?? '-'}`);
        return;
      }
      if (event.type === 'stream_event') {
        // Deltas: solo se cuentan, por `parent_tool_use_id` (¿llega el texto del subagente al stream?).
        const key = `stream_event parent=${event.parent_tool_use_id ?? '-'} ${event.event?.type ?? ''}`;
        streamCounts.set(key, (streamCounts.get(key) ?? 0) + 1);
        return;
      }
      const content = Array.isArray(event.message?.content) ? event.message.content : [];
      const kinds = content.map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)).join(',');
      rows.push(`${event.type}/${event.subtype ?? ''} parent=${event.parent_tool_use_id ?? '-'} ${kinds}`);
      if (event.type === 'result') { clearTimeout(timer); resolve(); }
    }));
  });
  const prompt = 'Usa la herramienta Agent (o Task) con subagent_type "general-purpose" y este encargo: ' +
    '"Usa la herramienta Glob con el patron *.json en el directorio actual y contesta solo con el numero de ficheros". ' +
    'Luego dime ese numero en una palabra. No hagas nada mas.';
  writeLine(child, { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null });
  await done;
  child.stdin.end();
  child.kill();
  console.log(`[subagent] eventos (sin deltas):\n  ${rows.join('\n  ')}`);
  console.log(`[subagent] deltas por padre:\n  ${[...streamCounts].map(([key, count]) => `${count}x ${key}`).join('\n  ')}`);
  const file = transcriptPath(IMAGE_SPIKE.accountDir, sessionId);
  if (fs.existsSync(file)) fs.rmSync(file);
  const sub = path.join(path.dirname(file), sessionId);
  if (fs.existsSync(sub)) fs.rmSync(sub, { recursive: true, force: true });
}

const MODES = { '--images': imageOrderSpike, '--rename': renameSpike, '--subagent': subagentSpike };
const entry = MODES[process.argv.find((arg) => arg in MODES)] ?? main;
entry().catch((err) => {
  console.error(`\n[spike] ERROR: ${err.message}`);
  process.exit(1);
});
