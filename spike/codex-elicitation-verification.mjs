// Medición directa de MCP con respuestas artificiales; nunca inicia turn/start.
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { initialized, rpcSession, verificationContext, verificationDependencies, cleanupContext } from './codex-verification.mjs';
import { THREAD_RESULT, validatedResult } from './codex-wire.mjs';
import { elicitationRequest, ELICITATION_ANSWER } from './codex-elicitation-server.mjs';

const POLL_MS = 25;
const REQUEST_TIMEOUT_MS = 30_000;
const FORM_CONTENT = { name: 'mage-artificial', count: 1, confirmed: true, choice: 'one' };
const ELICITATION_PARAMS = z.object({ threadId: z.string(), turnId: z.string().nullable(), serverName: z.literal('mage_elicitation'),
  mode: z.literal('form'), _meta: z.null(), message: z.string(), requestedSchema: z.unknown() }).strict();
const MCP_RESULT = z.object({ content: z.tuple([z.object({ type: z.literal('text'), text: z.string() }).strict()]), isError: z.literal(false) }).strict();

export function projectElicitation(params, kind) {
  const parsed = ELICITATION_PARAMS.safeParse(params);
  if (!parsed.success) throw new Error('Elicitation artificial: forma inesperada');
  const expected = elicitationRequest(kind);
  if (parsed.data.message !== expected.message || !isDeepStrictEqual(parsed.data.requestedSchema, expected.requestedSchema)) {
    throw new Error('Elicitation artificial: contenido ajeno a la prueba');
  }
  return { ...parsed.data, threadId: 'mage-artificial-thread', turnId: parsed.data.turnId === null ? null : 'mage-artificial-turn' };
}

export function projectMcpAnswer(reply, expected) {
  if (reply.error) throw new Error(`MCP artificial: código ${reply.error.code}`);
  const result = validatedResult(reply, MCP_RESULT, 'MCP artificial');
  let decoded;
  try { decoded = ELICITATION_ANSWER.parse(JSON.parse(result.content[0].text)); } catch {
    throw new Error('MCP artificial: respuesta inesperada');
  }
  if (!isDeepStrictEqual(decoded, expected)) throw new Error('MCP artificial: respuesta distinta de la esperada');
  return result;
}

async function awaitElicitation(session, offset) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const message = session.messages.slice(offset).find((entry) => entry.method === 'mcpServer/elicitation/request');
    if (message !== undefined) return message;
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
  throw new Error('No llegó elicitation en la llamada MCP directa');
}

async function measureAnswer(session, threadId, kind, action) {
  const offset = session.messages.length;
  const called = session.request('mcpServer/tool/call', { threadId, server: 'mage_elicitation', tool: kind, arguments: {} });
  // La promesa se vigila mientras llega la petición inversa para evitar rechazos sin manejar.
  const result = called.catch(() => ({ error: { code: -32000 } }));
  const request = await awaitElicitation(session, offset);
  const params = projectElicitation(request.params, kind);
  const answer = { action, content: action === 'accept' ? (kind === 'form' ? FORM_CONTENT : {}) : null };
  session.send({ jsonrpc: '2.0', id: request.id, result: answer });
  const reply = await result;
  const expected = action === 'accept' ? answer : { action };
  const mcpResult = projectMcpAnswer(reply, expected);
  const fixtureId = typeof request.id === 'number' ? 1 : 'mage-artificial-request';
  const envelope = request.jsonrpc === undefined ? {} : { jsonrpc: z.literal('2.0').parse(request.jsonrpc) };
  const record = { kind, action, request: { ...envelope, id: fixtureId, method: request.method, params },
    response: { jsonrpc: '2.0', id: fixtureId, result: answer }, mcpResult };
  console.log(JSON.stringify(record));
  return record;
}

export async function verifyElicitation() {
  const context = verificationContext(await verificationDependencies());
  const args = ['-c', `mcp_servers.mage_elicitation.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.mage_elicitation.args=${JSON.stringify([fileURLToPath(new URL('./codex-elicitation-server.mjs', import.meta.url)), '--serve-elicitation'])}`];
  const session = rpcSession({ ...context, args });
  try {
    console.log(`${context.version}; turnos reales=0`);
    await initialized(session);
    const reply = await session.request('thread/start', { cwd: context.workspace, model: 'gpt-6-luna', ephemeral: true });
    if (reply.error) throw new Error(`thread/start: código ${reply.error.code}`);
    const threadId = validatedResult(reply, THREAD_RESULT, 'thread/start').thread.id;
    await session.request('mcpServerStatus/list', { threadId });
    const records = [];
    for (const kind of ['confirmation', 'form']) {
      for (const action of ['accept', 'decline', 'cancel']) records.push(await measureAnswer(session, threadId, kind, action));
    }
    if (process.argv.includes('--save-fixture')) writeFileSync(new URL('./__fixtures__/codex-elicitation-0160.json', import.meta.url),
      `${JSON.stringify({ version: context.version, artificial: true, realTurns: 0, records }, null, 2)}\n`);
  } finally {
    await session.close();
    cleanupContext(context);
  }
}
