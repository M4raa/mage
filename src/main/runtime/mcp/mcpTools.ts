import { z } from 'zod';
import type { ToolOutcome } from '../agentLoop';
import { truncateOutput, type RuntimeTool, type ToolContext } from '../tools/types';

// Herramientas MCP del runtime propio (P-032 R8): cada herramienta de un servidor MCP entra en el
// registro como `mcp__<servidor>__<herramienta>` (el mismo nombre que les da el CLI de Claude: el chat
// las pinta igual y «Permitir siempre» funciona por nombre). Son de tipo `exec`: preguntan en Manual.
// PURO salvo `call`, que recibe inyectada la llamada al servidor.

const MCP_PREFIX = 'mcp__';
// Los nombres de funcion de Chat Completions admiten [a-zA-Z0-9_-] y como mucho 64 caracteres.
const TOOL_NAME_MAX = 64;

export function mcpToolName(server: string, tool: string): string {
  return `${MCP_PREFIX}${sanitize(server)}__${sanitize(tool)}`.slice(0, TOOL_NAME_MAX);
}

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Herramienta tal como la anuncia `tools/list`.
export interface McpToolInfo {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

// El contenido de `tools/call`: los bloques de texto se juntan; el resto se describe en una linea.
export interface McpCallResult {
  readonly content?: readonly unknown[] | undefined;
  readonly isError?: boolean | undefined;
  readonly structuredContent?: unknown;
}

export type McpCaller = (tool: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<McpCallResult>;

// Los argumentos van tal cual: el esquema que manda es el del servidor, y el servidor valida.
const ANY_OBJECT = z.record(z.string(), z.unknown());

export function mcpRuntimeTool(server: string, tool: McpToolInfo, call: McpCaller): RuntimeTool {
  return {
    name: mcpToolName(server, tool.name),
    kind: 'exec',
    description: (tool.description ?? `${tool.name} (servidor MCP ${server})`).slice(0, 1_000),
    fields: {},
    jsonSchema: normalizeSchema(tool.inputSchema),
    input: ANY_OBJECT,
    run: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> => flattenResult(await call(tool.name, input, ctx.signal)),
  };
}

// Un esquema sin `type: object` (o vacio) se completa: Chat Completions exige un objeto.
function normalizeSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (schema.type === 'object') return { ...schema };
  return { type: 'object', properties: {}, ...schema };
}

export function flattenResult(result: McpCallResult): ToolOutcome {
  const parts = (result.content ?? []).map(describeBlock).filter((part) => part.length > 0);
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  const output = parts.length === 0 ? '(sin contenido)' : parts.join('\n');
  return { isError: result.isError === true, output: truncateOutput(output) };
}

function describeBlock(block: unknown): string {
  if (typeof block !== 'object' || block === null) return '';
  const record = block as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  if (record.type === 'resource' && typeof record.resource === 'object' && record.resource !== null) {
    const resource = record.resource as Record<string, unknown>;
    return typeof resource.text === 'string' ? resource.text : `[recurso ${String(resource.uri ?? '')}]`;
  }
  if (record.type === 'resource_link') return `[enlace a recurso ${String(record.uri ?? '')}]`;
  if (record.type === 'image' || record.type === 'audio') return `[${record.type} ${String(record.mimeType ?? '')}: el runtime no lo muestra]`;
  return '';
}
