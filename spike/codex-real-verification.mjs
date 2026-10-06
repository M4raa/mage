// Medicion de la ruta REAL de Mage (AgentSession + CodexAdapter), con perfil temporal autenticado.
// Vite carga TypeScript sin generar otro adapter. Nunca se conecta a Electron ni al perfil del usuario.
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './codex-verification.mjs';
import { jsonLines, parseExternalJson, RPC_MESSAGE, THREAD_MARKER } from './codex-wire.mjs';
import { approvalSleep, safeSleep } from './codex-platform.mjs';
export { safeSleep } from './codex-platform.mjs';

const MODEL = 'gpt-6-luna';
const TIMEOUT_MS = 120_000;
const INTERRUPT_DELAY_MS = 1_000;
const TURN_POLL_MS = 100;

export async function verifyReal(context) {
  const loader = await context.deps.createLoader({ configFile: false, server: { middlewareMode: true },
    resolve: { alias: { '@shared': resolve('src/shared') } }, appType: 'custom' });
  try {
    const { CodexAdapter } = await loader.ssrLoadModule('/src/main/engine/codexAdapter.ts');
    const { AgentSession } = await loader.ssrLoadModule('/src/main/engine/agentSession.ts');
    if (process.argv.includes('--metadata')) {
      const { probeCodexAccount } = await loader.ssrLoadModule('/src/main/accounts/codexAccountProbe.ts');
      const metadata = await probeCodexAccount({ timeoutMs: 30_000, spawnProbe: (home) => metadataProcess(context, home) }, { home: context.home, includeApps: true });
      console.log('Sondeo de PRODUCCION:', JSON.stringify(metadata));
      return;
    }
    const harness = realSession({ context, CodexAdapter, AgentSession });
    try {
      await waitUntil(() => harness.events.some((e) => e.kind === 'session_init' || e.kind === 'error'), 'hilo');
      if (!harness.events.some((e) => e.kind === 'session_init')) throw new Error('Arranque rechazado; cero turnos');
      const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.split('=')[1] ?? 'minimal';
      await runScenario(harness, scenario);
    } finally {
      harness.session.stop();
      await harness.closed();
    }
  } finally {
    await loader.close();
  }
}

function metadataProcess(context, home) {
  const child = context.deps.spawn(context.bin, ['app-server'], { env: isolatedEnv(home, context.deps), stdio: 'pipe', windowsHide: true });
  child.stderr.resume();
  return { onStdout: (listener) => { child.stdout.setEncoding('utf8'); child.stdout.on('data', listener); },
    onExit: (listener) => { child.on('exit', listener); child.on('error', listener); },
    onError: (listener) => { child.on('error', listener); child.stdin.on('error', listener); },
    writeLine: (line) => child.stdin.write(`${line}\n`), endInput: () => child.stdin.end(),
    killTree: () => child.kill() };
}

function realSession({ context, CodexAdapter, AgentSession }) {
  const events = [];
  const raw = [];
  let child;
  const adapter = context.deps.createAdapter(CodexAdapter, { resolveBinary: () => context.bin,
    resolveAccount: () => ({ home: context.home, apiKey: null }),
    resolveInstructions: () => [{ scope: 'project', path: join(context.workspace, 'CLAUDE.md'), content: 'marker' }],
  });
  writeFileSync(join(context.workspace, 'CLAUDE.md'), 'Verification instruction: when asked for the project marker reply MAGE_PROJECT_OK.\n');
  const resumeFile = join(context.workspace, 'mage-thread.json');
  const resumed = process.argv.includes('--resume-real') ? parseExternalJson(readFileSync(resumeFile, 'utf8'), THREAD_MARKER, 'Marcador de hilo').threadId : undefined;
  const session = context.deps.createSession(AgentSession, { adapter, params: {
    sessionId: 'mage-verification', accountDir: context.home, cwd: context.workspace,
    model: MODEL, effort: 'low', permissionMode: ':read-only', conversationId: resumed,
    shared: { mcpServers: [verificationMcp()], settingsFragment: null, claudeAiConnectors: false },
  }, emit: (event) => recordEvent({ events, resumeFile }, event),
  spawn: recordedSpawn(raw, (value) => { child = value; }, context.deps.spawn) });
  session.start();
  return { session, events, raw, context, closed: () => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise((done) => child.once('close', done)) };
}

function recordEvent({ events, resumeFile }, event) {
  events.push(event);
  if (event.kind === 'error') console.log('Error Mage (categorias):', JSON.stringify({
    experimental: /experimental/i.test(event.message), permissions: /permissions|permission/i.test(event.message),
    auth: /auth|401/i.test(event.message), thread: /thread/i.test(event.message),
  }));
  if (event.kind === 'session_init') writeFileSync(resumeFile, JSON.stringify({ threadId: event.sessionId }));
  if (event.kind === 'permission_request') console.log(`Permiso recibido: ${event.request.toolName}; campos=${Object.keys(event.request.input).join(',')}`);
}

export function recordedSpawn(raw, onChild, spawnChild) {
  return (command, args, options) => {
    if (args.join(' ').includes('mage-artificial-mcp-secret')) throw new Error('Secreto artificial en argv');
    const child = spawnChild(command, args, options);
    onChild(child);
    child.stdout.on('data', jsonLines({ schema: RPC_MESSAGE, receive: (message) => raw.push(message),
      fail: () => { console.warn('Captura RPC inválida; se detiene la medición.'); child.kill(); } }));
    return child;
  };
}

function verificationMcp() {
  return { name: 'mage_verify', source: 'common', transport: 'stdio', onlyIn: { families: [], accounts: [] }, extra: {}, secrets: {},
    command: process.execPath, args: [fileURLToPath(new URL('./codex-verification.mjs', import.meta.url)), '--mcp-server'],
    env: { MAGE_VERIFY_MCP_SECRET: 'mage-artificial-mcp-secret' }, cwd: null };
}

async function runScenario(harness, scenario) {
  if (scenario === 'minimal') {
    await turn(harness, 'Call the mage_verify probe MCP tool once. Then reply with only the project marker from your project instructions and the marker returned by that tool. No shell commands.');
    const text = harness.events.filter((e) => e.kind === 'assistant_text').map((e) => e.text).join('');
    console.log(`Proyecto recibido=${text.includes('MAGE_PROJECT_OK')}; MCP llamado=${harness.events.some((e) => e.kind === 'tool_use' && e.tool.toolName.includes('mage_verify'))}; entorno MCP recibido=${text.includes('MAGE_MCP_ENV_OK')}`);
  } else if (scenario === 'resume') {
    await turn(harness, 'Reply only with the project marker and the MCP result marker from the earlier turn in this conversation. Do not call tools.');
    const text = harness.events.filter((e) => e.kind === 'assistant_text').map((e) => e.text).join('');
    console.log(`Contexto tras reiniciar=${text.includes('MAGE_PROJECT_OK') && text.includes('MAGE_MCP_ENV_OK')}`);
  } else if (scenario === 'approvals') {
    await measureApprovals(harness);
  } else throw new Error('Escenario real desconocido');
  console.log('Metodos observados:', JSON.stringify([...new Set(harness.raw.map((m) => m.method).filter(Boolean))]));
  console.log('Eventos Mage:', JSON.stringify(Object.fromEntries([...new Set(harness.events.map((e) => e.kind))].map((kind) => [kind, harness.events.filter((e) => e.kind === kind).length]))));
  const mcp = harness.raw.find((m) => m.method === 'item/completed' && m.params?.item?.type === 'mcpToolCall')?.params.item;
  if (mcp) console.log('MCP medido:', JSON.stringify({ fields: Object.keys(mcp), resultFields: Object.keys(mcp.result ?? {}),
    status: mcp.status, marker: JSON.stringify(mcp.result).includes('MAGE_MCP_ENV_OK'),
    outputInMage: harness.events.some((e) => e.kind === 'tool_result' && e.result.output.includes('MAGE_MCP_ENV_OK')) }));
}

async function measureApprovals(harness) {
  const offset = harness.events.length;
  const platform = harness.context.deps.platform;
  harness.session.sendUserMessage(`Verification only. Use the shell tool once to run ${approvalSleep(platform)}. Set sandbox_permissions to require_escalated and ask for approval. No other commands or file operations.`);
  console.log(`Turno real: modelo=${MODEL}; esfuerzo=low; aprobacion comando + interrupcion`);
  await waitUntil(() => harness.events.slice(offset).some((e) => e.kind === 'permission_request' || e.kind === 'result'), 'aprobacion comando');
  const request = harness.events.slice(offset).find((e) => e.kind === 'permission_request')?.request;
  console.log('Comando controlado:', JSON.stringify({ type: typeof request?.input.command,
    sleep: safeSleep(request?.input.command, platform) }));
  if (!request || request.toolName !== 'Bash' || !safeSleep(request.input.command, platform)) throw new Error('No llego el permiso del comando controlado; no se aprueba');
  harness.session.answerPermission(request.requestId, { behavior: 'allow' });
  await new Promise((done) => setTimeout(done, INTERRUPT_DELAY_MS));
  harness.session.interrupt();
  await waitUntil(() => harness.events.slice(offset).some((e) => e.kind === 'result'), 'interrupcion');
  console.log(`Comando aprobado=true; interrumpido=${harness.events.slice(offset).some((e) => e.kind === 'result' && e.result.subtype === 'interrupted')}`);
  const editOffset = harness.events.length;
  console.log(`Turno real: modelo=${MODEL}; esfuerzo=low; aprobacion edicion + continuacion`);
  harness.session.sendUserMessage('Continue after the interruption. Use apply_patch to create mage-edit.txt in the current project with exactly MAGE_EDIT_OK and a newline. Do not use shell commands, do not touch other paths. Ask for approval if needed. Reply OK.');
  await waitUntil(() => harness.events.slice(editOffset).some((e) => e.kind === 'permission_request' || e.kind === 'result'), 'aprobacion edicion');
  const edit = harness.events.slice(editOffset).find((e) => e.kind === 'permission_request')?.request;
  const item = harness.raw.find((m) => m.method === 'item/started' && m.params?.item?.id === edit?.toolUseId)?.params?.item;
  const changes = item?.changes;
  if (!edit || edit.toolName !== 'apply_patch' || !Array.isArray(changes) || changes.length !== 1 || resolve(changes[0].path) !== join(harness.context.workspace, 'mage-edit.txt')) throw new Error('Edicion fuera de la prueba o sin permiso; no se aprueba');
  console.log(`Edicion: diff recibido=${typeof changes[0].diff === 'string'}; diff en permiso Mage=${Array.isArray(edit.input.changes)}`);
  harness.session.answerPermission(edit.requestId, { behavior: 'allow' });
  await waitUntil(() => harness.events.slice(editOffset).some((e) => e.kind === 'result'), 'edicion completada');
  console.log(`Edicion aprobada y fichero correcto=${readFileSync(join(harness.context.workspace, 'mage-edit.txt'), 'utf8').trim() === 'MAGE_EDIT_OK'}`);
}

async function turn(harness, prompt) {
  const offset = harness.events.length;
  console.log(`Turno real: modelo=${MODEL}; esfuerzo=low; solicitud de 1 turno`);
  harness.session.sendUserMessage(prompt);
  await waitUntil(() => harness.events.slice(offset).some((e) => e.kind === 'result'), 'turno');
  const result = harness.events.slice(offset).find((e) => e.kind === 'result').result;
  console.log('Resultado:', JSON.stringify(result));
  if (result.isError) throw new Error('El turno real fallo (detalle omitido)');
}

async function waitUntil(predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timeout de ${label}; no se repite el turno automaticamente`);
    await new Promise((done) => setTimeout(done, TURN_POLL_MS));
  }
}
