// Servidor MCP stdio del benchmark (T4): una herramienta, `bench_marca`, que devuelve una marca fija.
// Sirve para comprobar que la ruta (CLI directo o Mage) hace llegar un MCP del proyecto al modelo.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'bench', version: '1.0.0' });
server.tool('bench_marca', 'Devuelve la marca de prueba del benchmark de Mage.', async () => ({ content: [{ type: 'text', text: 'MARCA-7Q' }] }));
await server.connect(new StdioServerTransport());
