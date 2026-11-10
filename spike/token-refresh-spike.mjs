// Mage — Spike del 2026-11-10 (P-038, «refrescar login»).
// Pregunta: con el token de ACCESO caducado y el de RENOVACIÓN presente, ¿qué hace que el CLI lo renueve SIN gastar un
// turno? Mage no renueva tokens por su cuenta (revisión legal): lo tiene que hacer el CLI.
//   --mode=initialize   arranca el CLI en stream-json, pide SOLO `initialize` y cierra (lo que hace el sondeo de modelos).
//   --mode=auth-status  `claude auth status` (si existe en esta versión).
// Mide `expiresAt` del .credentials.json antes y después. NUNCA imprime tokens: solo fechas y si cambió el fichero.
// Uso: node spike/token-refresh-spike.mjs --config-dir <dir> [--mode=initialize|auth-status]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const configDir = arg('--config-dir');
const mode = process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ?? 'initialize';
if (configDir === null) throw new Error('Falta --config-dir <dir>');
const credentials = path.join(configDir, '.credentials.json');

function expiry() {
  const oauth = JSON.parse(fs.readFileSync(credentials, 'utf8')).claudeAiOauth ?? {};
  const at = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null;
  return { expiresAt: at === null ? null : new Date(at).toISOString(), horasRestantes: at === null ? null : Number(((at - Date.now()) / 3.6e6).toFixed(1)), mtime: fs.statSync(credentials).mtime.toISOString() };
}

const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];

function runInitialize() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { env, cwd: configDir, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let buffer = '';
    let answered = false;
    const done = (result) => {
      clearTimeout(timer);
      try { child.stdin.end(); } catch {}
      setTimeout(() => { child.kill(); resolve({ ...result, ms: Date.now() - started }); }, 1500);
    };
    const timer = setTimeout(() => done({ respuesta: 'timeout' }), 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n').slice(0, -1)) {
        try {
          const event = JSON.parse(line);
          if (!answered && event.type === 'control_response') {
            answered = true;
            // La respuesta trae `account`: no se lee. Solo si fue éxito o error.
            done({ respuesta: event.response?.subtype ?? 'desconocida' });
          }
        } catch {}
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    });
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'spike-1', request: { subtype: 'initialize' } })}\n`);
  });
}

function runAuthStatus() {
  return new Promise((resolve) => {
    const child = spawn('claude', ['auth', 'status'], { env, cwd: configDir, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => resolve({ code, salida: out.length > 0 ? `${out.length} caracteres (no se imprimen)` : 'vacía' }));
  });
}

const antes = expiry();
const resultado = mode === 'auth-status' ? await runAuthStatus() : await runInitialize();
await new Promise((r) => setTimeout(r, 1000));
const despues = expiry();
console.log(JSON.stringify({ mode, antes, resultado, despues, renovado: antes.expiresAt !== despues.expiresAt }, null, 2));
