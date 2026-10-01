// Servidor MCP FALSO por stdio (JSON-RPC por lineas) para los tests del runtime propio (P-032 R8).
// Una herramienta `eco` que devuelve lo que recibe. Con `--morir` sale al recibir `initialize`.
import { createInterface } from 'node:readline';

const dies = process.argv.includes('--morir');
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    if (dies) process.exit(3);
    send({ id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'falso', version: '1.0.0' } } });
    return;
  }
  if (request.method === 'tools/list') {
    send({
      id: request.id,
      result: {
        tools: [{ name: 'eco', description: 'Devuelve el texto', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }],
      },
    });
    return;
  }
  if (request.method === 'tools/call') {
    send({ id: request.id, result: { content: [{ type: 'text', text: `eco: ${request.params.arguments.texto} (${process.env.MCP_FALSO_MARCA ?? 'sin marca'})` }] } });
    return;
  }
  if (request.id !== undefined) send({ id: request.id, error: { code: -32601, message: `metodo no simulado: ${request.method}` } });
});
