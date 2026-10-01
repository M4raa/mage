import { z } from 'zod';
import type { CodexAppView } from '@shared/mcp';

// Lo que Mage lee de codex sobre MCP y conectores, sin arrancar ningun servidor ni gastar un turno.
// Esquemas PROPIOS y tolerantes, medidos contra codex-cli 0.144.4 (`spike/mcp-providers-spike.mjs`):
//  - `codex mcp list --json`: el inventario de su `config.toml` (y de los `-c` de la invocacion). OJO:
//    trae los VALORES de `env`, asi que la salida no sale de main.
//  - `app/list` de `codex app-server`: las Apps de ChatGPT (conectores). SIN VERIFICAR: sin sesion de
//    ChatGPT devuelve `{data:[]}`; los campos salen del esquema que genera
//    `codex app-server generate-json-schema` (AppInfo, marcado EXPERIMENTAL).
// Lo enchufa el adapter de codex (se lanza con el `CODEX_HOME` de cada cuenta).

export const CODEX_MCP_LIST_ARGS: readonly string[] = ['mcp', 'list', '--json'];
export const CODEX_APP_LIST_METHOD = 'app/list';

const STDIO_TRANSPORT = z
  .object({
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).nullable().catch(null),
    env: z.record(z.string(), z.string()).nullable().catch(null),
    cwd: z.string().nullable().catch(null),
  })
  .passthrough();

const HTTP_TRANSPORT = z
  .object({
    type: z.literal('streamable_http'),
    url: z.string(),
    http_headers: z.record(z.string(), z.string()).nullable().catch(null),
    bearer_token_env_var: z.string().nullable().catch(null),
  })
  .passthrough();

const LIST_ENTRY = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().catch(true),
    disabled_reason: z.string().nullable().catch(null),
    transport: z.union([STDIO_TRANSPORT, HTTP_TRANSPORT, z.object({ type: z.string() }).passthrough()]),
    auth_status: z.string().nullable().catch(null),
  })
  .passthrough();

export interface CodexMcpServer {
  readonly name: string;
  readonly enabled: boolean;
  readonly authStatus: string | null;
  // Declaracion con la forma de `.mcp.json` (la que entiende el inventario). null = transporte que Mage
  // no conoce: se enseña el nombre sin config.
  readonly config: Readonly<Record<string, unknown>> | null;
}

// Parsea la salida de `codex mcp list --json`. JSON invalido o que no es una lista LANZA con el tamaño
// (nunca el texto: lleva valores de env). Una entrada que no encaja se omite, no tumba al resto.
export function parseCodexMcpList(text: string): readonly CodexMcpServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`codex mcp list --json no devolvió JSON (${error instanceof Error ? error.message : String(error)}): ${text.length} caracteres`);
  }
  if (!Array.isArray(parsed)) throw new Error(`codex mcp list --json no devolvió una lista (${typeof parsed})`);
  return parsed.flatMap((item) => {
    const result = LIST_ENTRY.safeParse(item);
    if (!result.success) return [];
    const { name, enabled, auth_status: authStatus, transport } = result.data;
    return [{ name, enabled, authStatus, config: configOf(transport) }];
  });
}

function configOf(transport: z.infer<typeof LIST_ENTRY>['transport']): Readonly<Record<string, unknown>> | null {
  const stdio = STDIO_TRANSPORT.safeParse(transport);
  if (stdio.success) {
    const { command, args, env, cwd } = stdio.data;
    return { type: 'stdio', command, ...(args === null ? {} : { args }), ...(env === null ? {} : { env }), ...(cwd === null ? {} : { cwd }) };
  }
  const http = HTTP_TRANSPORT.safeParse(transport);
  if (!http.success) return null;
  return { type: 'http', url: http.data.url, ...(http.data.http_headers === null ? {} : { headers: http.data.http_headers }) };
}

const APP_INFO = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().catch(null),
    isEnabled: z.boolean().catch(true),
    isAccessible: z.boolean().catch(false),
    installUrl: z.string().nullable().catch(null),
  })
  .passthrough();

const APP_LIST_RESULT = z.object({ data: z.array(z.unknown()), nextCursor: z.string().nullable().catch(null) }).passthrough();

// `result` de una respuesta `app/list`. Devuelve las apps y el cursor para pedir la pagina siguiente.
export function parseCodexAppList(result: unknown): { readonly apps: readonly CodexAppView[]; readonly nextCursor: string | null } {
  const parsed = APP_LIST_RESULT.safeParse(result);
  if (!parsed.success) throw new Error(`Respuesta de app/list inesperada: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`);
  const apps = parsed.data.data.flatMap((item) => {
    const app = APP_INFO.safeParse(item);
    if (!app.success) return [];
    const { id, name, description, isEnabled, isAccessible, installUrl } = app.data;
    return [{ id, name, description: description ?? '', enabled: isEnabled, accessible: isAccessible, installUrl }];
  });
  return { apps, nextCursor: parsed.data.nextCursor };
}
