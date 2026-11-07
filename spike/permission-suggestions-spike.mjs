// Spike: ¿que trae el `can_use_tool` del CLI de Claude en `permission_suggestions`, y aplica el CLI las
// reglas que Mage le devuelve en `updatedPermissions` con destino `session` y `localSettings`?
// Es la medicion en la que se apoyan los botones «Permitir en esta sesion» y «Permitir siempre».
//
// UN proceso de claude en stream-json (como una pestaña de Mage), modelo haiku, carpeta de trabajo desechable,
// la cuenta de ~/.claude (sin CLAUDE_CONFIG_DIR: no se copian credenciales). Como mucho 3 turnos:
//   T1 `mkdir probe-a`  -> se espera can_use_tool; se responde allow + sugerencias con destino `session`.
//   T2 `mkdir probe-b`  -> si la regla de sesion vale, NO llega can_use_tool.
//   T3 `rmdir probe-a`  -> can_use_tool; allow + sugerencias con destino `localSettings` (fichero de la carpeta
//                          desechable, nunca el settings.json de la cuenta).
// Imprime solo tool_name, input y permission_suggestions; nunca credenciales ni el texto del modelo.
//
// MEDIDO el 2026-11-07 contra claude 2.1.319 (dos pasadas, 6 turnos haiku/low):
//   - `permission_suggestions` de un Bash trae tres entradas: `addRules` {toolName:'Bash', ruleContent:'mkdir probe-a *'}
//     (behavior allow, destination localSettings), `addDirectories` (la carpeta, destination session) y `setMode`
//     acceptEdits (destination session). Mage solo reenvía los `addRules`: los otros dos ampliarían otra cosa.
//   - La regla es el comando entero seguido de ` *` (no `Bash(mkdir:*)`): `mkdir probe-b` vuelve a preguntar.
//   - Con `updatedPermissions` y destino `localSettings`, el CLI escribe `permissions.allow: ["Bash(rmdir probe-a *)"]` en
//     `<cwd>/.claude/settings.local.json`. El destino `userSettings` (el de «Permitir siempre») escribe igual en el
//     settings.json del CLAUDE_CONFIG_DIR de la cuenta; no se mide aquí para no tocar la configuración real.
//   - Claves del can_use_tool en 2.1.319: subtype, tool_name, display_name, input, description, permission_suggestions,
//     blocked_path, decision_reason, decision_reason_type, classifier_approvable, tool_use_id, suppress_always_allow_rule.
//
// Uso: node spike/permission-suggestions-spike.mjs

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TURN_TIMEOUT_MS = 120_000;
const CREDENTIAL_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR'];
const TURNS = [
  { prompt: 'Run exactly this shell command with the Bash tool and nothing else: mkdir probe-a', destination: 'session' },
  { prompt: 'Run exactly this shell command with the Bash tool and nothing else: mkdir probe-b', destination: 'session' },
  { prompt: 'Run exactly this shell command with the Bash tool and nothing else: rmdir probe-a', destination: 'localSettings' },
];

function claudeBinary() {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return fs.existsSync(local) ? local : 'claude';
}

function childEnv() {
  const env = { ...process.env };
  for (const name of CREDENTIAL_VARS) delete env[name];
  return env;
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-i3-perm-'));
const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--permission-mode', 'default', '--model', 'haiku', '--effort', 'low'];
const child = spawn(claudeBinary(), args, { cwd: workDir, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const version = { cli: null };
const log = [];
let turnIndex = -1;
let buffer = '';
let resolveTurn = null;

function send(payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function answer(request) {
  const turn = TURNS[turnIndex];
  const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [];
  const updatedPermissions = suggestions.filter((s) => s?.type === 'addRules').map((s) => ({ ...s, destination: turn.destination }));
  log.push({ turn: turnIndex + 1, event: 'can_use_tool', tool: request.tool_name, input: request.input, permission_suggestions: request.permission_suggestions ?? null, keys: Object.keys(request), answeredWith: updatedPermissions });
  send({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: { behavior: 'allow', updatedInput: request.input, toolUseID: request.tool_use_id, updatedPermissions } } });
}

function onLine(line) {
  if (line.trim() === '') return;
  const msg = JSON.parse(line);
  if (msg.type === 'system' && msg.subtype === 'init') version.cli = msg.claude_code_version ?? null;
  if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') answer({ ...msg.request, request_id: msg.request_id });
  if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) if (block.type === 'tool_result') log.push({ turn: turnIndex + 1, event: 'tool_result', is_error: block.is_error ?? false, content: String(typeof block.content === 'string' ? block.content : JSON.stringify(block.content)).slice(0, 300) });
  }
  if (msg.type === 'result') {
    log.push({ turn: turnIndex + 1, event: 'result', subtype: msg.subtype, usage: msg.usage ? { input: msg.usage.input_tokens, output: msg.usage.output_tokens } : null });
    resolveTurn?.();
  }
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    onLine(line);
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function runTurn(index) {
  turnIndex = index;
  const done = new Promise((resolve, reject) => {
    resolveTurn = resolve;
    setTimeout(() => reject(new Error(`Turno ${index + 1} sin result en ${TURN_TIMEOUT_MS} ms`)), TURN_TIMEOUT_MS);
  });
  send({ type: 'user', uuid: randomUUID(), message: { role: 'user', content: TURNS[index].prompt } });
  await done;
}

try {
  for (let i = 0; i < TURNS.length; i++) await runTurn(i);
  const local = path.join(workDir, '.claude', 'settings.local.json');
  log.push({ event: 'settings.local.json', exists: fs.existsSync(local), content: fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : null });
  log.push({ event: 'dirs', entries: fs.readdirSync(workDir) });
} finally {
  child.stdin.end();
  child.kill();
  console.log(JSON.stringify({ cliVersion: version.cli, workDir, log }, null, 2));
}
