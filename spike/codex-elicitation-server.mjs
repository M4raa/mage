// MCP artificial de stdio: provoca elicitation desde tools/call, sin consultar un modelo.
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { parseExternalJson, RPC_MESSAGE } from './codex-wire.mjs';

export const ELICITATION_SCHEMAS = {
  confirmation: { type: 'object', properties: {}, required: [] },
  form: { type: 'object', properties: {
    name: { type: 'string', title: 'Nombre artificial', minLength: 1 },
    count: { type: 'integer', title: 'Cantidad', minimum: 1, maximum: 3 },
    confirmed: { type: 'boolean', title: 'Confirmación' },
    choice: { type: 'string', title: 'Opción', enum: ['one', 'two'] },
  }, required: ['name', 'count', 'confirmed', 'choice'] },
};
const CALL = z.object({ name: z.enum(['confirmation', 'form']), arguments: z.object({}).optional() });
export const ELICITATION_ANSWER = z.object({ action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.union([z.string(), z.number(), z.boolean()])).nullable().optional() }).strict();

export function elicitationRequest(kind) {
  if (!Object.hasOwn(ELICITATION_SCHEMAS, kind)) throw new Error('Tipo de elicitation artificial inválido');
  return { mode: 'form', message: kind === 'confirmation' ? 'MAGE_CONFIRM: ¿continuar?' : 'MAGE_FORM: datos artificiales',
    requestedSchema: ELICITATION_SCHEMAS[kind] };
}

export function serveElicitation({ readLines, write }) {
  const pending = new Map();
  let nextId = 0;
  const send = (message) => write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const receive = (message) => {
    if (message.id === undefined) return;
    if (message.method === undefined) {
      const call = pending.get(message.id);
      if (call === undefined) return;
      pending.delete(message.id);
      const parsed = ELICITATION_ANSWER.safeParse(message.result);
      const text = parsed.success ? JSON.stringify(parsed.data) : 'MAGE_ELICITATION_INVALID_RESPONSE';
      send({ id: call, result: { content: [{ type: 'text', text }], isError: !parsed.success } });
      return;
    }
    if (message.method !== 'tools/call') { send({ id: message.id, result: staticResult(message) }); return; }
    const parsed = CALL.safeParse(message.params);
    if (!parsed.success) { send({ id: message.id, error: { code: -32602, message: 'Petición artificial inválida' } }); return; }
    const id = `mage-elicitation-${++nextId}`;
    pending.set(id, message.id);
    send({ id, method: 'elicitation/create', params: elicitationRequest(parsed.data.name) });
  };
  readLines().on('line', (line) => {
    try { receive(parseExternalJson(line, RPC_MESSAGE, 'MCP artificial')); } catch {
      send({ id: null, error: { code: -32700, message: 'JSON MCP artificial inválido' } });
    }
  });
}

function staticResult(message) {
  if (message.method === 'initialize') {
    const params = z.object({ protocolVersion: z.string() }).parse(message.params);
    return { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Mage elicitation artificial', version: '1' } };
  }
  if (message.method === 'tools/list') return { tools: Object.keys(ELICITATION_SCHEMAS).map((name) => ({
    name, description: `MAGE_ELICITATION_${name}`, inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  })) };
  return {};
}

if (process.argv.includes('--serve-elicitation')) serveElicitation({
  readLines: () => createInterface({ input: process.stdin }), write: (line) => process.stdout.write(line),
});
