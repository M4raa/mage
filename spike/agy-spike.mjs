// Mage — Spike del CLI de Antigravity (`agy`) como posible motor nativo.
// Objetivo: medir si `agy` expone un protocolo de salida estructurada utilizable por AgentSession, y
// si permite delegar los permisos en Mage (decision nº 2 del proyecto). Ejecutado el 2026-08-09
// contra `agy` 1.1.2; conclusiones anotadas en el informe del spike.
//
// Re-medido el 2026-08-11 contra `agy` 1.1.11 antes de escribir el adapter (E3). Dos hallazgos que
// cambian lo que decia §5.5 y que este script comprueba:
//  1. `--conversation <id-arbitrario>` NO vale: responde `warning: conversation "…" not found` y
//     arranca una conversacion nueva. Hay que capturar el `conversation_id` que emite `agy` en su
//     `init` (viaja tambien en la raiz de cada step_update y del result) y devolverselo. Lo comprueba
//     `probeArbitraryConversation`, que es GRATIS (el prompt vacio corta antes de gastar peticion).
//  2. En 1.1.11 el modo por defecto (`request-review`) YA NO deja la tool en `state: ERROR`: con
//     `--add-dir` la escritura se aplica sin preguntar y sin emitir nada que Mage pueda contestar.
//     Sigue sin haber puente de permisos, pero el sintoma es otro. Se ve con `--live`.
//
// Por que existe este script: la nota del ROADMAP del 2026-07-15 dio `agy` por descartado leyendo su
// `--help`, y `--help` MIENTE POR OMISION (`--output-format` no aparece pero existe). Esto vuelve a
// medirlo de verdad, para poder repetirlo en cada actualizacion del CLI en vez de fiarse de una nota.
//
// NO es codigo de produccion. Identificadores en ingles, comentarios en castellano.
//
// Uso:
//   node spike/agy-spike.mjs          # solo sondas GRATIS (no gasta ni una peticion)
//   node spike/agy-spike.mjs --live   # ademas, 2 turnos reales (consume suscripcion, poco)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG = {
  binary: process.platform === 'win32' ? 'agy.exe' : 'agy',
  probeTimeoutMs: 20_000,
  liveTimeoutMs: 150_000,
  printTimeout: '90s',
};

// Flags a sondear. El oraculo: un flag INEXISTENTE responde "flags provided but not defined";
// uno EXISTENTE pero sin valor responde "flag needs an argument". Ninguno de los dos gasta peticiones.
const FLAGS_TO_PROBE = [
  'output-format',
  'effort',
  'input-format',
  'permission-prompt-tool',
  'session-id',
  'include-partial-messages',
  'mcp-config',
  'settings',
  'allowed-tools',
  'verbose',
];

function run(args, { timeoutMs, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(CONFIG.binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(err), code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

// Clasifica la respuesta del binario a un flag suelto.
function classifyFlagProbe(output) {
  if (output.includes('not defined')) return 'no existe';
  if (output.includes('needs an argument')) return 'EXISTE (oculto si no sale en --help)';
  return 'indeterminado';
}

async function probeFlags() {
  console.log('\n=== Sondeo de flags (gratis, sin peticiones) ===');
  const help = await run(['--help'], { timeoutMs: CONFIG.probeTimeoutMs });
  const helpText = `${help.stdout}${help.stderr}`;
  for (const flag of FLAGS_TO_PROBE) {
    const probe = await run([`--${flag}`], { timeoutMs: CONFIG.probeTimeoutMs });
    const verdict = classifyFlagProbe(`${probe.stdout}${probe.stderr}`);
    const inHelp = helpText.includes(`--${flag}`) ? 'sí' : 'NO';
    console.log(`  --${flag.padEnd(26)} en --help: ${inHelp.padEnd(3)} -> ${verdict}`);
  }
}

// Borra el workspace temporal. En Windows `agy` puede dejar un handle abierto un instante y el rm
// falla con EPERM: es un directorio de /tmp, asi que se AVISA (nunca se traga) y se sigue.
function removeWorkspace(workspace) {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch (err) {
    console.log(`  (no se pudo borrar ${workspace}: ${err.code ?? err.message} — borralo a mano)`);
  }
}

function parseNdjson(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: 'NO_PARSEABLE', raw: line.slice(0, 120) };
      }
    });
}

// Turno real con stream-json. `conversationId` continua una conversacion existente. Devuelve los
// eventos NDJSON parseados.
async function liveStreamTurn(workspace, prompt, conversationId = null) {
  const args = [
    '--output-format',
    'stream-json',
    '--add-dir',
    workspace, // SIN esto, agy escribe en su propio scratch e ignora el cwd
    '--print-timeout',
    CONFIG.printTimeout,
  ];
  if (conversationId !== null) args.push('--conversation', conversationId);
  args.push('--print', prompt);
  const result = await run(args, { timeoutMs: CONFIG.liveTimeoutMs, cwd: workspace });
  return parseNdjson(result.stdout);
}

// ¿Acepta `--conversation` un id que elija Mage? GRATIS: el prompt vacio aborta antes de gastar
// peticion, y el aviso de "not found" ya sale. La respuesta manda en el diseno del adapter: si el id
// no se puede imponer, hay que capturar el que genera el CLI y reusarlo turno a turno.
async function probeArbitraryConversation() {
  console.log('\n=== ¿Se puede imponer un id en --conversation? (gratis) ===');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-agy-conv-'));
  try {
    const invented = '11111111-1111-1111-1111-111111111111';
    const result = await run(
      ['--output-format', 'stream-json', '--add-dir', workspace, '--conversation', invented, '--print', ''],
      { timeoutMs: CONFIG.probeTimeoutMs, cwd: workspace },
    );
    const notFound = `${result.stdout}${result.stderr}`.includes('not found');
    console.log(`  id inventado -> ${notFound ? 'RECHAZADO ("conversation not found")' : 'aceptado (¡re-mide el diseno!)'}`);
    for (const event of parseNdjson(result.stdout)) {
      if (event.event === 'result') console.log(`  result status=${event.result?.status} error=${JSON.stringify(event.result?.error)}`);
    }
  } finally {
    removeWorkspace(workspace);
  }
}

function printEvents(events) {
  for (const event of events) {
    const update = event.step_update;
    if (event.event === 'init') {
      console.log(
        `  init         conversation=${event.conversation_id} tools=${event.init?.tools?.length ?? 0} permission_mode=${event.init?.permission_mode}`,
      );
    } else if (event.event === 'step_update') {
      const detail = update?.tool_name ? ` tool=${update.tool_name}` : '';
      const delta = update?.text_delta ? ` delta=${JSON.stringify(update.text_delta.slice(0, 40))}` : '';
      console.log(`  step_update  [${update?.step_index}] ${update?.state} ${update?.step_type}${detail}${delta}`);
    } else if (event.event === 'result') {
      const usage = event.result?.usage ?? {};
      console.log(`  result       status=${event.result?.status} turns=${event.result?.num_turns}`);
      console.log(`               usage in=${usage.input_tokens} out=${usage.output_tokens} thinking=${usage.thinking_tokens} cache_read=${usage.cache_read_tokens}`);
    } else {
      console.log(`  ${event.event}`);
    }
  }
}

async function probeLive() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-agy-spike-'));
  try {
    console.log('\n=== Turno 1: prompt trivial con --output-format stream-json ===');
    const first = await liveStreamTurn(workspace, 'reply with exactly: OK');
    if (first.length === 0) {
      console.log('  (sin salida: ¿sesión sin login? ejecuta `agy` una vez y autentícate)');
      return;
    }
    printEvents(first);

    // El id que hay que reusar sale del propio CLI (uno inventado no vale, ver probeArbitraryConversation).
    const conversationId = first.find((event) => event.event === 'init')?.conversation_id ?? null;
    if (conversationId === null) {
      console.log('\n  (sin conversation_id en el init: el multi-turno de un proceso por turno NO es posible)');
      return;
    }

    console.log(`\n=== Turno 2: --conversation ${conversationId} (¿recuerda? ¿cachea? ¿escribe donde toca?) ===`);
    const second = await liveStreamTurn(
      workspace,
      'Write the word you just replied into a file named memo.txt in the workspace.',
      conversationId,
    );
    printEvents(second);
    const memo = path.join(workspace, 'memo.txt');
    console.log(`  memo.txt en el workspace: ${fs.existsSync(memo) ? JSON.stringify(fs.readFileSync(memo, 'utf8')) : 'NO EXISTE'}`);

    console.log('\n  Conclusiones (ver el informe de E3):');
    console.log('   - Hay stream estructurado: init + step_update (con text_delta y tool calls) + result.');
    console.log('   - El usage es REAL, por paso y total, con thinking y cache_read.');
    console.log('   - Multi-turno entre PROCESOS distintos con el conversation_id que el CLI genera.');
    console.log('   - NO hay puente de permisos: la escritura se aplica sin preguntar y sin avisar.');
  } finally {
    removeWorkspace(workspace);
  }
}

async function main() {
  const version = await run(['--version'], { timeoutMs: CONFIG.probeTimeoutMs });
  const found = version.code === 0;
  console.log(`agy: ${found ? `v${version.stdout.trim()}` : 'NO ENCONTRADO en el PATH'}`);
  if (!found) process.exit(1);

  await probeFlags();
  await probeArbitraryConversation();
  if (process.argv.includes('--live')) await probeLive();
  else console.log('\n(pasa --live para ejecutar además 2 turnos reales; consume suscripción)');
}

void main();
