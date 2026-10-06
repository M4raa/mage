import { z } from 'zod';
import { resolve, join } from 'node:path';

// Proyecciones cerradas: solo el contenido artificial exacto puede llegar al fixture publico.
const FILE = z.object({ type: z.literal('fileChange'), status: z.literal('completed'), changes: z.array(z.object({
  path: z.string(), kind: z.object({ type: z.literal('add') }).strict(), diff: z.literal('MAGE_EDIT_OK\n'),
}).strict()).length(1) });
const MCP = z.object({ type: z.literal('mcpToolCall'), server: z.literal('mage_verify'), tool: z.literal('probe'),
  status: z.literal('completed'), result: z.object({ content: z.array(z.object({
    type: z.literal('text'), text: z.literal('MAGE_MCP_ENV_OK'),
  }).strict()).min(1) }) });

export function projectVerificationFile(file, workspace) {
  const parsed = FILE.safeParse(file);
  if (typeof workspace !== 'string' || !parsed.success) throw new Error('Edición fuera del contrato artificial de verificación.');
  if (resolve(workspace, parsed.data.changes[0].path) !== join(resolve(workspace), 'mage-edit.txt')) {
    throw new Error('Edición fuera del contrato artificial de verificación.');
  }
  return { type: 'fileChange', id: 'edit-measured', status: 'completed',
    changes: [{ path: '<workspace>/mage-edit.txt', kind: { type: 'add' }, diff: 'MAGE_EDIT_OK\n' }] };
}

export function projectVerificationMcp(item) {
  const parsed = MCP.safeParse(item);
  if (!parsed.success) throw new Error('Resultado MCP fuera del contrato artificial de verificación.');
  return { type: 'mcpToolCall', id: 'mcp-measured', server: 'mage_verify', tool: 'probe', arguments: {}, status: 'completed',
    result: { content: parsed.data.result.content, structuredContent: null }, error: null };
}
