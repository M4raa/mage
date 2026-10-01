// Mage — Spike de MCP en los otros CLI (agy y codex): como guardan sus servidores, como se les inyecta
// uno por sesion y que inventario dan sin arrancar nada. Es la medicion en la que se apoyan
// `mcpProviderTranslate.ts` (toCodexOverrides / toAgyConfig) y `codexMcp.ts` (lectura de
// `codex mcp list --json` y de `app/list`). Medido el 2026-10-01 contra agy 1.2.14 y codex-cli 0.144.4
// (sin sesion de ChatGPT).
//
// GRATIS: ningun turno de modelo. Nunca toca la configuracion real del usuario: agy corre con
// `USERPROFILE`/`HOME` apuntando a una carpeta temporal (su raiz `.gemini` sigue al perfil y no hay
// variable propia para moverla) y codex con `CODEX_HOME` temporal. Al final compara el hash de los
// ficheros reales antes y despues, y falla si cambiaron.
//
// NO es codigo de produccion. Identificadores en ingles, comentarios en castellano.
//
// Uso:
//   node spike/mcp-providers-spike.mjs            # agy + codex
//   node spike/mcp-providers-spike.mjs --agy      # solo agy
//   node spike/mcp-providers-spike.mjs --codex    # solo codex
//   node spike/mcp-providers-spike.mjs --claude   # solo la expansion de ${VAR} en --mcp-config

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

const CONFIG = {
  agy: process.platform === 'win32' ? 'agy.exe' : 'agy',
  codex: 'codex',
  timeoutMs: 30_000,
  appServerTimeoutMs: 20_000,
};

// Ficheros reales que el spike NO puede cambiar.
const REAL_FILES = [path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'), path.join(os.homedir(), '.codex', 'config.toml')];

function hashOf(file) {
  return fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

function run(bin, args, env) {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', timeout: CONFIG.timeoutMs, windowsHide: true });
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

// En Windows el app-server deja un hijo (codex-code-mode-host) que retiene la carpeta unos segundos: si
// no se puede borrar se dice cual queda (es temporal, nunca la real).
function removeHome(home) {
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (err) {
    console.log(`  (no se pudo borrar la carpeta temporal ${home}: ${err.code ?? err.message})`);
  }
}

function isolatedHome(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mage-mcp-spike-${label}-`));
}

// --- agy -------------------------------------------------------------------------------------------

function measureAgy() {
  const home = isolatedHome('agy');
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  const file = path.join(home, '.gemini', 'config', 'mcp_config.json');
  console.log(`\n== agy ${run(CONFIG.agy, ['--version'], env).stdout} (USERPROFILE=${home})`);
  // Oraculo de flags de sesion: ninguno existe (medido: «flags provided but not defined»).
  for (const flag of ['mcp-config', 'mcp', 'settings', 'extensions', 'allowed-mcp-server-names']) {
    const r = run(CONFIG.agy, [`--${flag}`], env);
    const verdict = /not defined/.test(r.stderr + r.stdout) ? 'no existe' : /needs an argument/.test(r.stderr + r.stdout) ? 'EXISTE' : 'indeterminado';
    console.log(`  --${flag}: ${verdict}`);
  }
  console.log('  add stdio:', run(CONFIG.agy, ['mcp', 'add', '--env', 'VG_KEY=vg-secret', 'vg-local', 'node', 'server.js'], env).status);
  console.log('  add http :', run(CONFIG.agy, ['mcp', 'add', '--header', 'X-Key: vg-secret', 'vg-remote', 'https://vg.invalid/mcp'], env).status);
  console.log('  list     :', run(CONFIG.agy, ['mcp', 'list'], env).stdout.replace(/\n/g, ' | '));
  // Forma en disco (lo que escribe `toAgyConfig`). Los valores son los falsos de arriba.
  console.log('  fichero  :', fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ') : '(no existe)');
  // Mage escribe el fichero directamente: ¿lo relee agy con una clave de nivel superior propia?
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  written.mcpServers['vg-mage'] = { command: 'node', args: ['mage.js'], env: {}, disabled: false };
  fs.writeFileSync(file, JSON.stringify(written, null, 2));
  console.log('  tras escribir Mage:', run(CONFIG.agy, ['mcp', 'list'], env).stdout.replace(/\n/g, ' | '));
  fs.rmSync(home, { recursive: true, force: true });
}

// --- codex -----------------------------------------------------------------------------------------

function measureCodex() {
  const home = isolatedHome('codex');
  const env = { ...process.env, CODEX_HOME: home };
  console.log(`\n== ${run(CONFIG.codex, ['--version'], env).stdout} (CODEX_HOME=${home})`);
  run(CONFIG.codex, ['mcp', 'add', '--env', 'VG_KEY=vg-secret', 'vg-local', '--', 'node', 'server.js'], env);
  run(CONFIG.codex, ['mcp', 'add', 'vg-remote', '--url', 'https://vg.invalid/mcp', '--bearer-token-env-var', 'VG_TOKEN'], env);
  console.log('  config.toml:', fs.readFileSync(path.join(home, 'config.toml'), 'utf8').replace(/\n/g, ' | '));
  console.log('  list --json:', run(CONFIG.codex, ['mcp', 'list', '--json'], env).stdout.replace(/\s+/g, ' '));
  // Inyeccion por sesion sin escribir nada: -c con valores TOML y los secretos por variable.
  const overrides = [
    '-c', 'mcp_servers.vg-injected.command="node"',
    '-c', 'mcp_servers.vg-injected.args=["x.js","--flag"]',
    '-c', 'mcp_servers.vg-injected.env_vars=["MAGE_MCP_VG_INJECTED_KEY"]',
    '-c', 'mcp_servers.vg-http.url="https://vg.invalid/h"',
    '-c', 'mcp_servers.vg-http.env_http_headers={"X-K"="MAGE_MCP_VG_HTTP_X_K"}',
  ];
  console.log('  -c + list  :', run(CONFIG.codex, [...overrides, 'mcp', 'list', '--json'], env).stdout.replace(/\s+/g, ' '));
  console.log('  toml intacto tras -c:', !fs.readFileSync(path.join(home, 'config.toml'), 'utf8').includes('vg-injected'));
  // Escapado: cadenas basicas de TOML con las secuencias de JSON (ruta de Windows con espacios, comillas).
  const escaped = run(CONFIG.codex, ['-c', 'mcp_servers.vg-esc.command="C:\\\\a b\\\\srv.exe"', '-c', 'mcp_servers.vg-esc.args=["q\\"r"]', 'mcp', 'list', '--json'], env);
  console.log('  escapado   :', JSON.stringify(JSON.parse(escaped.stdout).find((s) => s.name === 'vg-esc')?.transport));
  // `env_vars` NO renombra: la forma objeto solo admite source local|remote (por eso Mage reenvia la
  // variable con su mismo nombre).
  const renamed = run(CONFIG.codex, ['-c', 'mcp_servers.x.command="node"', '-c', 'mcp_servers.x.env_vars=[{name="K",source="OTRA"}]', 'mcp', 'list', '--json'], env);
  console.log('  env_vars objeto:', (renamed.stderr.split('\n').find((l) => l.includes('source')) ?? renamed.stderr).trim());
  // La ruta de -c no admite claves entre comillas: un nombre con punto no se puede inyectar.
  const dotted = run(CONFIG.codex, ['-c', 'mcp_servers."a.b".command="node"', 'mcp', 'list', '--json'], env);
  console.log('  nombre con punto:', dotted.status === 0 ? 'aceptado' : (dotted.stderr.split('\n').find((l) => l.includes('invalid')) ?? dotted.stderr).trim());
  // Claves de OAuth que escribe `codex mcp add --oauth-client-id/--oauth-resource`.
  run(CONFIG.codex, ['mcp', 'add', 'vg-oauth', '--url', 'https://vg.invalid/o', '--oauth-client-id', 'cid', '--oauth-resource', 'https://res'], env);
  const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  console.log('  oauth en toml:', /oauth_resource = /.test(toml) && /\[mcp_servers\.vg-oauth\.oauth\]\s*\nclient_id = /.test(toml));
  return measureAppServer(env).finally(() => removeHome(home));
}

// `codex app-server` por stdio (JSON-RPC, una linea por mensaje): initialize, mcpServerStatus/list y
// app/list. Sin sesion de ChatGPT: app/list sale vacio.
function measureAppServer(env) {
  return new Promise((resolve) => {
    const child = spawn(CONFIG.codex, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const pending = new Map();
    let buffer = '';
    const timer = setTimeout(() => finish('plazo agotado'), CONFIG.appServerTimeoutMs);
    const finish = (why) => {
      clearTimeout(timer);
      if (why) console.log('  app-server:', why);
      // Se espera a que muera: en Windows su carpeta sigue bloqueada mientras vive.
      child.once('exit', () => resolve());
      child.kill();
    };
    const call = (id, method, params) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return new Promise((res) => pending.set(id, res));
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length === 0) continue;
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      }
    });
    (async () => {
      const init = await call(1, 'initialize', { clientInfo: { name: 'mage-spike', title: 'Mage spike', version: '0' } });
      console.log('  initialize :', init.error ? `error ${JSON.stringify(init.error)}` : 'ok');
      const status = await call(2, 'mcpServerStatus/list', {});
      console.log('  mcpServerStatus/list:', JSON.stringify(status.result ?? status.error));
      const apps = await call(3, 'app/list', {});
      console.log('  app/list   :', JSON.stringify(apps.result ?? apps.error));
      finish(null);
    })().catch((err) => finish(String(err)));
  });
}

// --- Claude: ¿expande ${VAR} en un fichero de --mcp-config? ---------------------------------------
// Sin turno: CLAUDE_CONFIG_DIR vacio, `mcp_status` por stream-json, un servidor stdio que vuelca el
// argumento y la variable que recibe y uno http que registra la cabecera. Medido en 2.1.286: SI, en
// args, env y headers. Es lo que permite que el --mcp-config que genera Mage no lleve ningun valor.

function measureClaude() {
  const dir = isolatedHome('claude');
  const out = path.join(dir, 'out.json');
  const server = path.join(dir, 'server.cjs');
  fs.writeFileSync(server, [
    "const fs = require('fs');",
    'fs.writeFileSync(process.env.VG_OUT, JSON.stringify({ arg: process.argv[2], key: process.env.VG_KEY }));',
    "let b = ''; process.stdin.on('data', (c) => { b += c; let i; while ((i = b.indexOf('\\n')) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l);",
    "  if (m.id === undefined) continue; const result = m.method === 'initialize' ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'vg', version: '0' } } : { tools: [] };",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); } });",
  ].join('\n'));

  return new Promise((resolve) => {
    let header = null;
    const srv = http.createServer((req, res) => { header ??= req.headers['x-vg'] ?? null; res.statusCode = 404; res.end(); });
    srv.listen(0, '127.0.0.1', () => {
      const cfg = path.join(dir, 'cfg.json');
      fs.writeFileSync(cfg, JSON.stringify({ mcpServers: {
        vgexp: { type: 'stdio', command: process.execPath, args: [server, '${VG_ARG}'], env: { VG_KEY: '${VG_KEY_SRC}', VG_OUT: out } },
        vgh: { type: 'http', url: `http://127.0.0.1:${srv.address().port}/mcp`, headers: { 'X-VG': 'Bearer ${VG_H}' } },
      } }));
      const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, 'cfg'), VG_ARG: 'arg-expandido', VG_KEY_SRC: 'env-expandido', VG_H: 'cabecera-expandida' };
      delete env.ANTHROPIC_API_KEY;
      const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--mcp-config', cfg], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let buffer = '';
      let n = 0;
      const finish = () => {
        clearInterval(timer);
        child.kill();
        srv.close();
        const got = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
        console.log(`\n== claude ${run('claude', ['--version'], env).stdout}: --mcp-config expande ${'$'}{VAR}`);
        console.log(`  args: ${got?.arg === 'arg-expandido'}  env: ${got?.key === 'env-expandido'}  headers: ${header === 'Bearer cabecera-expandida'}`);
        removeHome(dir);
        resolve();
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const statuses = buffer.split('\n').flatMap((line) => { try { const m = JSON.parse(line); return m.type === 'control_response' ? [m.response.response?.mcpServers ?? []] : []; } catch { return []; } });
        if (statuses.some((list) => list.length === 2 && list.every((s) => s.status !== 'pending'))) finish();
      });
      const timer = setInterval(() => {
        child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: `r${++n}`, request: { subtype: 'mcp_status' } })}\n`);
        if (n > 15) finish();
      }, 1_500);
    });
  });
}

// --- Main ------------------------------------------------------------------------------------------

const only = process.argv.slice(2);
const before = REAL_FILES.map(hashOf);
if (only.length === 0 || only.includes('--agy')) measureAgy();
if (only.length === 0 || only.includes('--codex')) await measureCodex();
if (only.length === 0 || only.includes('--claude')) await measureClaude();
const after = REAL_FILES.map(hashOf);
const untouched = before.every((hash, i) => hash === after[i]);
console.log(`\nConfiguracion real intacta: ${untouched} (${REAL_FILES.map((f, i) => `${path.basename(f)}=${before[i]?.slice(0, 12) ?? 'ausente'}`).join(', ')})`);
if (!untouched) process.exitCode = 1;
