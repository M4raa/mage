// cp/M-03: `mage mcp` contra un Mage REAL sin ventanas (el main construido), SIN turnos de modelo (0 turnos reales).
// Mide: las seis herramientas `mage_*`, el rechazo de un cliente sin sesión de Mage (M-U2) con y sin credencial
// inventada, que con Mage parado `mage mcp` sale con 1 sin arrancar nada, y los tiempos de initialize y listTools.
// Requiere `pnpm build` antes (out/main/index.js). Medido contra: protocolo del host 1.5, SDK MCP del repo.
// Uso: node spike/mage-mcp-relay.mjs --out <fichero.json>
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const MAIN_ENTRY = join(repo, 'out', 'main', 'index.js');
const MAGE_CLI = join(repo, 'scripts', 'mage-cli', 'mage.mjs');
const HOST_WAIT_MS = 30_000;
const POLL_MS = 250;
const EXIT_TIMEOUT_MS = 15_000;
const PROFILE_PREFIX = 'mage-m-mcp-';
const EXPECTED_TOOLS = ['mage_cancel', 'mage_create_session', 'mage_get_status', 'mage_list_sessions', 'mage_read_result', 'mage_send'];
const FAKE_CALLER = 'ab'.repeat(32);
const NO_HOST_TEXT_ES = 'Mage no está abierto: `mage mcp` solo funciona desde una sesión de Mage.';
const NO_HOST_TEXT_EN = 'Mage is not open: `mage mcp` only works from a Mage session.';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

function outPath() {
  const position = process.argv.indexOf('--out');
  const value = position === -1 ? undefined : process.argv[position + 1];
  if (value === undefined || value.startsWith('--')) throw new Error('Uso: node spike/mage-mcp-relay.mjs --out <fichero.json>');
  return resolve(value);
}

// PID de los procesos Electron cuyo perfil es `dir` (la línea de órdenes lleva --user-data-dir=<dir>).
function profilePids(dir) {
  if (process.platform === 'win32') {
    const script = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${dir.replaceAll("'", "''")}*' } | ForEach-Object { $_.ProcessId }`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean).map(Number).sort((a, b) => a - b);
  }
  const out = execFileSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8' });
  return out.split('\n').filter((line) => /electron/i.test(line) && line.includes(dir)).map((line) => Number(line.trim().split(/\s+/)[0])).sort((a, b) => a - b);
}

function killTree(pid) {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGKILL');
}

async function waitForHostFiles(runDir) {
  const start = nowMs();
  while (nowMs() - start < HOST_WAIT_MS) {
    if (existsSync(runDir) && ['host-endpoint', 'host-token'].every((name) => readdirSync(runDir).includes(name))) return;
    await sleep(POLL_MS);
  }
  throw new Error(`El host no escribió sus ficheros en ${runDir} en ${HOST_WAIT_MS} ms`);
}

async function withMcpClient(profile, env, body) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [MAGE_CLI, 'mcp', '--user-data-dir', profile], env, stderr: 'pipe' });
  const client = new Client({ name: 'mage-spike', version: '1' });
  const startedAt = nowMs();
  await client.connect(transport);
  const initializeMs = nowMs() - startedAt;
  try {
    return await body(client, initializeMs);
  } finally {
    await client.close();
  }
}

const isExternalRejection = (result) => result.isError === true && JSON.stringify(result).includes('mage_external_caller');

async function measureOpen(profile, env) {
  return withMcpClient(profile, env, async (client, initializeMs) => {
    const listStart = nowMs();
    const { tools } = await client.listTools();
    const listToolsMs = nowMs() - listStart;
    const call = await client.callTool({ name: 'mage_list_sessions', arguments: {} });
    return { initializeMs, listToolsMs, toolNames: tools.map((tool) => tool.name).sort(), externalRejection: isExternalRejection(call) };
  });
}

// `mage mcp` con Mage parado: debe salir con 1, con el texto de mcpNoHost, sin crear procesos.
function runRelayWithoutHost(profile) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [MAGE_CLI, 'mcp', '--user-data-dir', profile], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), EXIT_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, stderr: stderr.trim(), stdout }); });
  });
}

async function main() {
  const out = outPath();
  if (!existsSync(MAIN_ENTRY)) {
    console.error(`No existe ${MAIN_ENTRY}: ejecuta «pnpm build» antes.`);
    process.exit(1);
  }
  const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const electron = requireFromRepo('electron');
  const mage = spawn(electron, [MAIN_ENTRY, '--headless', `--user-data-dir=${profile}`], {
    stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true,
  });
  const report = { spike: 'mage-mcp-relay', checkpoint: 'cp/M-03', realTurns: 0, at: new Date().toISOString() };
  try {
    await waitForHostFiles(join(profile, 'run'));
    const clean = { ...process.env };
    delete clean.MAGE_MCP_CALLER;
    const known = await measureOpen(profile, clean);
    report.r1 = { ok: JSON.stringify(known.toolNames) === JSON.stringify(EXPECTED_TOOLS), toolNames: known.toolNames };
    report.r2 = { ok: known.externalRejection };
    const forged = await measureOpen(profile, { ...clean, MAGE_MCP_CALLER: FAKE_CALLER });
    report.r3 = { ok: forged.externalRejection };
    report.tiempos = { initializeMs: known.initializeMs, listToolsMs: known.listToolsMs };
    killTree(mage.pid);
    await sleep(POLL_MS * 4);
    const before = profilePids(profile);
    const run = await runRelayWithoutHost(profile);
    const after = profilePids(profile);
    const textOk = run.stderr === NO_HOST_TEXT_ES || run.stderr === NO_HOST_TEXT_EN;
    report.r4 = { ok: run.code === 1 && textOk && run.stdout === '' && JSON.stringify(before) === JSON.stringify(after), exitCode: run.code, stderr: run.stderr, pidsBefore: before, pidsAfter: after };
  } finally {
    try { killTree(mage.pid); } catch { /* ya parado */ }
    await sleep(POLL_MS * 4);
    rmSync(profile, { recursive: true, force: true });
  }
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(['r1', 'r2', 'r3', 'r4'].every((key) => report[key]?.ok === true) ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
