// Modos históricos: medición en un perfil nuevo; el perfil real no se lee ni se compara por hashes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rpcSession, captureResponses } from './codex-verification.mjs';
import { validatedResult, THREAD_RESULT, RESPONSES_BODY } from './codex-wire.mjs';
import { z } from 'zod';

const WAIT_BEFORE_INTERRUPT_MS = 2_500;
const WAIT_AFTER_INTERRUPT_MS = 1_500;
const RESPONSE_TIMEOUT_MS = 15_000;
const RESPONSE_POLL_MS = 100;
const FALLBACK = ['-c', 'project_doc_fallback_filenames=["CLAUDE.md"]'];
const FAKE_KEY = 'mage-artificial-key';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function probeAppServer(context) {
  // La captura cruda histórica no ofrece una whitelist de credenciales. Se usan los fixtures
  // artificiales cerrados del modo --verify --inspect-thread para cualquier captura pública.
  if (process.env.MAGE_CODEX_FIXTURES !== undefined) throw new Error('Captura histórica cruda deshabilitada: usa --verify --inspect-thread con contenido artificial.');
  const session = rpcSession(context);
  try {
    await initialize(session);
    await measureInventory(session);
    await measureInterruptedTurn(session, context);
  } finally { await session.close(); }
  if (process.argv.includes('--key')) await measureFakeKeys(context);
  console.log('Perfil real de Codex: no consultado.');
}

async function initialize(session) {
  const reply = await session.request('initialize', { clientInfo: { name: 'mage-spike', version: '0' }, capabilities: { experimentalApi: true } });
  if (reply.error) throw new Error(`initialize: código ${reply.error.code}`);
  session.send({ jsonrpc: '2.0', method: 'initialized' });
}

async function measureInventory(session) {
  for (const method of ['account/read', 'model/list', 'permissionProfile/list', 'collaborationMode/list', 'account/rateLimits/read']) {
    const reply = await session.request(method);
    console.log(`${method}: campos=${JSON.stringify(Object.keys(reply.result ?? {}))}; código=${reply.error?.code ?? 'ninguno'}`);
  }
}

async function measureInterruptedTurn(session, context) {
  const opened = await session.request('thread/start', { cwd: context.workspace, approvalPolicy: 'on-request', ephemeral: true });
  const threadId = validatedResult(opened, THREAD_RESULT, 'thread/start').thread.id;
  const turn = await session.request('turn/start', { threadId, input: [{ type: 'text', text: 'hi', text_elements: [] }] });
  const turnId = validatedResult(turn, z.object({ turn: z.object({ id: z.string() }) }), 'turn/start').turn.id;
  await wait(WAIT_BEFORE_INTERRUPT_MS);
  await session.request('turn/interrupt', { threadId, turnId });
  await wait(WAIT_AFTER_INTERRUPT_MS);
  console.log('Métodos del turno:', JSON.stringify(session.messages.map((message) => message.method)));
}

async function measureFakeKeys(context) {
  const providerArgs = ['-c', 'model_providers.mage-openai={name="OpenAI",base_url="https://api.openai.com/v1",env_key="MAGE_CODEX_API_KEY",wire_api="responses"}', '-c', 'model_provider="mage-openai"'];
  const cases = [
    ['CODEX_API_KEY', [], { CODEX_API_KEY: FAKE_KEY }],
    ['OPENAI_API_KEY', [], { OPENAI_API_KEY: FAKE_KEY }],
    ['env_key', providerArgs, { MAGE_CODEX_API_KEY: FAKE_KEY }],
  ];
  for (const [label, args, env] of cases) {
    const session = rpcSession({ ...context, args, env });
    try {
      await initialize(session);
      await measureInterruptedTurn(session, context);
      const detail = session.messages.find((message) => message.method === 'error')?.params?.error;
      const text = JSON.stringify(detail);
      console.log(`${label}: clave enviada=${/Incorrect API key/.test(text)}; falta bearer=${/Missing bearer/.test(text)}`);
    } finally { await session.close(); }
  }
}

export async function probeInstructions(context) {
  const capture = await captureResponses(context.deps);
  try {
    await measureInstructionCases(context, capture);
    console.log(`Peticiones capturadas: ${capture.bodies.length}; perfil real no consultado.`);
  } finally {
    capture.server.closeAllConnections();
    await new Promise((done) => capture.server.close(done));
  }
}

async function measureInstructionCases(context, capture) {
  const scenarios = [
    { files: { 'ws:CLAUDE.md': 'MARK-CLAUDE-PROJ' }, markers: ['MARK-CLAUDE-PROJ'] },
    { files: { 'ws:CLAUDE.md': 'MARK-CLAUDE-PROJ' }, args: FALLBACK, markers: ['MARK-CLAUDE-PROJ'] },
    { files: {}, thread: { developerInstructions: 'MARK-DEV-START' }, markers: ['MARK-DEV-START'] },
    { files: { 'home:AGENTS.md': 'MARK-CODEX-HOME' }, markers: ['MARK-CODEX-HOME'] },
    { files: { 'ws:AGENTS.md': 'MARK-AGENTS-PROJ', 'ws:CLAUDE.md': 'MARK-CLAUDE-PROJ' }, args: FALLBACK, markers: ['MARK-AGENTS-PROJ', 'MARK-CLAUDE-PROJ'] },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const measured = await instructionTurn(context, capture, scenario);
    console.log(`Caso ${index + 1}:`, JSON.stringify(scenario.markers.map((marker) => ({ marker, ...instructionLocation(measured.body, marker) }))));
  }
  const first = await instructionTurn(context, capture, { files: {}, thread: { developerInstructions: 'MARK-DEV-FIRST' } });
  const resumed = await instructionTurn(context, capture, { files: {}, thread: { developerInstructions: 'MARK-DEV-RESUME' }, resumeId: first.threadId, resumeContext: first });
  console.log('Resume:', JSON.stringify(['MARK-DEV-FIRST', 'MARK-DEV-RESUME'].map((marker) => ({ marker, ...instructionLocation(resumed.body, marker) }))));
}

async function instructionTurn(context, capture, scenario) {
  const { home, workspace } = scenario.resumeContext ?? prepareInstructionFiles(context, scenario.files);
  const args = ['-c', `model_providers.mage-fake={name="Fake",base_url="http://127.0.0.1:${capture.port}/v1",env_key="MAGE_VERIFY_FAKE_KEY",wire_api="responses"}`, '-c', 'model_provider="mage-fake"', ...(scenario.args ?? [])];
  const session = rpcSession({ ...context, home, workspace, args, env: { MAGE_VERIFY_FAKE_KEY: FAKE_KEY } });
  try {
    await initialize(session);
    const method = scenario.resumeId === undefined ? 'thread/start' : 'thread/resume';
    const reply = await session.request(method, { cwd: workspace, threadId: scenario.resumeId, ...scenario.thread });
    const threadId = validatedResult(reply, THREAD_RESULT, method).thread.id;
    const offset = capture.bodies.length;
    await session.request('turn/start', { threadId, input: [{ type: 'text', text: 'hi', text_elements: [] }] });
    await waitForResponse(capture, offset);
    return { threadId, body: capture.bodies[offset], home, workspace };
  } finally { await session.close(); }
}

function prepareInstructionFiles(context, files) {
  const id = context.deps.nextScenarioId();
  const scenarioDir = join(context.workspace, `scenario-${id}`);
  const home = join(context.home, `scenario-${id}`);
  context.deps.mkdir(scenarioDir);
  context.deps.mkdir(home);
  for (const [key, content] of Object.entries(files)) {
    const [scope, name] = key.split(':');
    writeFileSync(join(scope === 'home' ? home : scenarioDir, name), content);
  }
  return { home, workspace: scenarioDir };
}

async function waitForResponse(capture, offset) {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  while (capture.bodies.length === offset) {
    if (Date.now() >= deadline) throw new Error('Responses local no contestó dentro del plazo.');
    await wait(RESPONSE_POLL_MS);
  }
  await wait(WAIT_AFTER_INTERRUPT_MS);
}

export function instructionLocation(raw, marker) {
  const body = RESPONSES_BODY.safeParse(raw);
  if (!body.success) throw new Error('Responses local con forma inesperada.');
  const input = z.array(z.object({ role: z.string().optional(), type: z.string().optional(), content: z.unknown().optional() }).passthrough()).safeParse(body.data.input ?? []);
  if (!input.success) throw new Error('Input de Responses local con forma inesperada.');
  return { base: body.data.instructions?.includes(marker) === true,
    roles: input.data.filter((item) => (JSON.stringify(item.content) ?? '').includes(marker)).map((item) => item.role ?? item.type) };
}
