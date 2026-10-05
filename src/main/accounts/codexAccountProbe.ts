import { z } from 'zod';
import type { CodexAccountMetadata } from '@shared/mcp';
import type { ProbeProcess } from '../engine/modelProbe';
import { parseCodexAppList } from '../config/codexMcp';

// 0.160.0: account/read confirma el login sin leer auth.json. app/list puede fallar AUN autenticado.
// Los errores contienen solo metodo/codigo: la respuesta cruda de OAuth nunca sale hacia IPC/logs.
export interface CodexAccountProbeDeps {
  readonly spawnProbe: (home: string) => ProbeProcess;
  readonly timeoutMs: number;
}
const REPLY = z.object({ id: z.string().optional(), result: z.unknown().optional(), error: z.object({ code: z.number() }).passthrough().optional() }).passthrough();
const ACCOUNT = z.object({ account: z.object({ type: z.string() }).passthrough().nullable() }).passthrough();
const INIT = 'mage-codex-init';
const ACCOUNT_ID = 'mage-codex-account';
const APPS_ID = 'mage-codex-apps';

export function probeCodexAccount(deps: CodexAccountProbeDeps, params: { readonly home: string; readonly includeApps: boolean }): Promise<CodexAccountMetadata> {
  return new Promise((resolve) => {
    let child: ProbeProcess;
    try { child = deps.spawnProbe(params.home); } catch {
      resolve({ authenticated: null, apps: null, error: 'No se pudo arrancar el CLI de Codex.' });
      return;
    }
    const state = { buffer: '', done: false, authenticated: null as boolean | null, apps: [] as CodexAccountMetadata['apps'], cursors: new Set<string>() };
    const finish = (error: string | null): void => {
      if (state.done) return;
      state.done = true;
      clearTimeout(timer);
      child.killTree();
      resolve({ authenticated: state.authenticated, apps: error === null ? state.apps : null, error });
    };
    const send = (id: string, method: string, payload: unknown): void => child.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params: payload }));
    const timer = setTimeout(() => finish('Codex no respondió dentro del plazo.'), deps.timeoutMs);
    child.onExit(() => finish('El CLI de Codex terminó antes de responder.'));
    child.onStdout((chunk) => {
      state.buffer += chunk;
      const parts = state.buffer.split('\n');
      state.buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (state.done) break;
        handleReply(line, { state, send, finish, includeApps: params.includeApps, child });
      }
    });
    send(INIT, 'initialize', { clientInfo: { name: 'mage', version: '0.1.2' }, capabilities: { experimentalApi: true } });
  });
}

interface ReplyContext {
  readonly state: { authenticated: boolean | null; apps: CodexAccountMetadata['apps']; cursors: Set<string> };
  readonly send: (id: string, method: string, payload: unknown) => void;
  readonly finish: (error: string | null) => void;
  readonly includeApps: boolean;
  readonly child: ProbeProcess;
}

function handleReply(line: string, ctx: ReplyContext): void {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return; } // Los avisos no JSON no son respuestas RPC.
  const parsed = REPLY.safeParse(raw);
  if (!parsed.success) return;
  const { id, error, result } = parsed.data;
  if (id !== INIT && id !== ACCOUNT_ID && id !== APPS_ID) return;
  if (error !== undefined) return ctx.finish(`Codex rechazó ${id === APPS_ID ? 'la consulta de Apps' : 'la consulta de cuenta'} (código ${error.code}).`);
  if (id === INIT) {
    ctx.child.writeLine(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
    return ctx.send(ACCOUNT_ID, 'account/read', {});
  }
  if (id === ACCOUNT_ID) {
    const account = ACCOUNT.safeParse(result);
    if (!account.success) return ctx.finish('Codex devolvió un estado de cuenta inesperado.');
    ctx.state.authenticated = account.data.account?.type === 'chatgpt';
    if (!ctx.includeApps || !ctx.state.authenticated) return ctx.finish(null);
    return ctx.send(APPS_ID, 'app/list', { limit: 50 });
  }
  appendApps(result, ctx);
}

function appendApps(result: unknown, ctx: ReplyContext): void {
  try {
    const page = parseCodexAppList(result);
    ctx.state.apps = [...(ctx.state.apps ?? []), ...page.apps];
    if (page.nextCursor === null) return ctx.finish(null);
    if (ctx.state.cursors.has(page.nextCursor)) return ctx.finish('Codex repitió el cursor de Apps.');
    ctx.state.cursors.add(page.nextCursor);
    ctx.send(APPS_ID, 'app/list', { limit: 50, cursor: page.nextCursor });
  } catch {
    ctx.finish('Codex devolvió una lista de Apps inesperada.'); // Nunca citar el cuerpo externo.
  }
}
