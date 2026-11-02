// cp/E-01: registro de los CLI y seis herramientas con fixtures, SIN turnos de modelo.
// Requiere Node con registerHooks (comprobado localmente: v24.16.0); no hace build ni bundle.
// node spike/mcp-server-spike.mjs [--claude-bin <ruta>] [--codex-bin <ruta>]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spikePath = fileURLToPath(import.meta.url);
const requireFromRepo = createRequire(join(repo, 'package.json'));
const ts = requireFromRepo('typescript');
const TIMEOUT_MS = 30_000;
const NAME = 'mage-spike';
const SYNTHETIC_REQUEST = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-31T12:00:00.000Z';

// Compila TS en memoria; los paquetes siguen resolviéndose desde node_modules del repo.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(specifier, context.parentURL);
      if (!candidate.pathname.endsWith('.ts') && existsSync(`${fileURLToPath(candidate)}.ts`)) candidate.pathname += '.ts';
      return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.ts')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true } });
    return { format: 'module', source: result.outputText, shortCircuit: true };
  },
});
const loadRepo = (path) => import(pathToFileURL(join(repo, path)).href);
const lib = await loadRepo('src/main/mcpServer/index.ts');
const { scrubAgentEnv } = await loadRepo('src/main/os/agentEnv.ts');

async function serve() {
  const cwd = process.cwd();
  let next = 0;
  const port = new lib.MemorySessionsPort({
    targets: [{ projectId: 'synthetic-project', accountId: 'synthetic-account', provider: 'claude', cwd }],
    now: () => NOW, newConversationId: () => `synthetic-${++next}`,
  });
  await lib.startMageMcpServer({ port, now: () => NOW, store: new lib.MemoryIdempotencyStore(),
    scope: { projectIds: ['synthetic-project'], accountIds: ['synthetic-account'] }, transport: new StdioServerTransport() });
}
function option(name) {
  const position = process.argv.indexOf(name);
  if (position === -1) return undefined;
  const value = process.argv[position + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name}: falta ruta`);
  return resolve(value);
}
function safeRemove(root, target) {
  const base = realpathSync(root);
  const resolved = realpathSync(target);
  const child = relative(base, resolved);
  assert(child !== '' && !child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child), 'limpieza fuera del mkdtemp propio');
  rmSync(resolved, { recursive: true, force: false });
}
async function run(binary, args, environment) {
  const { killProcessTree, defaultKillTreeDeps } = await loadRepo('src/main/os/processTree.ts');
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { env: environment.env, cwd: environment.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killProcessTree(child, defaultKillTreeDeps()); }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
    // No imprimir errores crudos del CLI; incluso con fixtures pueden contener datos de máquina.
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error(`No se pudo lanzar ${args[0]}`)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut || code !== 0) { reject(new Error(`CLI ${args[0]}: ${timedOut ? 'timeout' : `exit ${code}`}`)); return; }
      resolveRun(stdout);
    });
  });
}
async function probeTools(environment) {
  const client = new Client({ name: 'mage-spike-fixture', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [spikePath, '--serve'], ...environment, stderr: 'ignore' });
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 6);
    const call = async (tool, args, schema) => {
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: TIMEOUT_MS });
      assert.notEqual(result.isError, true, `${tool}: error MCP`);
      return schema.parse(result.structuredContent);
    };
    await call('mage_list_sessions', {}, lib.listOutputSchema);
    const created = await call('mage_create_session', { requestId: SYNTHETIC_REQUEST, provider: 'claude', cwd: environment.cwd, prompt: 'Synthetic fixture only' }, lib.createOutputSchema);
    const conversationId = created.conversationId;
    await call('mage_get_status', { conversationId }, lib.statusOutputSchema);
    await call('mage_read_result', { conversationId }, lib.readOutputSchema);
    await call('mage_send', { conversationId, requestId: SYNTHETIC_REQUEST, text: 'Synthetic delivery', mode: 'queue' }, lib.sendOutputSchema);
    await call('mage_cancel', { conversationId, scope: 'turn' }, lib.cancelOutputSchema);
    console.log('PASS stdio seis herramientas con entradas y salidas H1');
  } finally {
    // El transporte SDK cierra exclusivamente el PID que él mismo creó.
    await client.close();
    await transport.close();
  }
}
async function measure() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mage-mcp-spike-')));
  const claudeDir = join(root, 'claude');
  const codexHome = join(root, 'codex');
  const cwd = join(root, 'workspace');
  [claudeDir, codexHome, cwd].forEach((dir) => mkdirSync(dir));
  const environment = { cwd, env: Object.fromEntries(Object.entries(scrubAgentEnv(process.env)).filter(([, value]) => typeof value === 'string')) };
  environment.env.CLAUDE_CONFIG_DIR = claudeDir;
  environment.env.CODEX_HOME = codexHome;
  const registered = [];
  const cleanupErrors = [];
  try {
    const { resolveClaudeBinary } = await loadRepo('src/main/os/claudeBinaryResolver.ts');
    const { resolveCodexBinary } = await loadRepo('src/main/os/codexBinaryResolver.ts');
    const claude = option('--claude-bin') ?? resolveClaudeBinary();
    const codex = option('--codex-bin') ?? resolveCodexBinary();
    for (const [name, binary] of [['claude', claude], ['codex', codex]]) {
      console.log(`VERSION ${name}: ${(await run(binary, ['--version'], environment)).trim()}`);
    }
    // Flags exactos medidos en H4, no deducidos de --help.
    const removeClaude = ['mcp', 'remove', NAME, '--scope', 'user'];
    const removeCodex = ['mcp', 'remove', NAME];
    registered.push([claude, removeClaude]);
    await run(claude, ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', NAME, '--', process.execPath, spikePath, '--serve'], environment);
    registered.push([codex, removeCodex]);
    await run(codex, ['mcp', 'add', NAME, '--', process.execPath, spikePath, '--serve'], environment);
    const claudeList = await run(claude, ['mcp', 'list'], environment);
    assert(claudeList.split('\n').some((line) => line.includes(NAME) && /connected/i.test(line) && !/failed|disconnected/i.test(line)), 'Claude no confirma Connected');
    assert((await run(codex, ['mcp', 'list'], environment)).includes(NAME), 'Codex no lista mage-spike');
    console.log('PASS registros aislados Claude/Codex y conexión Claude');
    await probeTools(environment);
  } finally {
    for (const [binary, args] of registered.reverse()) {
      try { await run(binary, args, environment); }
      catch (error) { cleanupErrors.push(error); console.error(`FAIL limpieza registro: ${error.message}`); }
    }
    for (const dir of [claudeDir, codexHome, cwd]) {
      try { safeRemove(root, dir); }
      catch (error) { cleanupErrors.push(error); console.error(`FAIL limpieza directorio propio: ${error.message}`); }
    }
    // Solo rmdir no recursivo para la raíz obtenida de mkdtemp, ya comprobada y vacía.
    try { rmdirSync(root); }
    catch (error) { cleanupErrors.push(error); console.error(`FAIL limpieza raíz propia: ${error.message}`); }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Falló la limpieza del spike');
    console.log('PASS limpieza de registros y directorios desechables');
  }
}
if (process.argv.includes('--serve')) await serve();
else await measure();
