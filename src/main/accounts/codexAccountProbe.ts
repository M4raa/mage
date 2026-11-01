import { z } from 'zod';
import { foreignText, localized, localizedWithParts, type LocalizedText } from '@shared/i18n/localizedText';
import type { CodexAccountMetadata, CodexAppView } from '@shared/mcp';
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
const APP_PAGE_SIZE = 50;
const TRANSPORT_FAILED = localized('mcp.main.codexProbeTransportFailed');
const PROBE_INPUT = z.object({ home: z.string().trim().min(1), includeApps: z.boolean(), timeoutMs: z.number().finite().positive() });

export function probeCodexAccount(deps: CodexAccountProbeDeps, params: { readonly home: string; readonly includeApps: boolean }): Promise<CodexAccountMetadata> {
  if (!PROBE_INPUT.safeParse({ ...params, timeoutMs: deps.timeoutMs }).success) {
    return Promise.resolve({ authenticated: null, apps: null, error: foreignText('Parámetros del sondeo de Codex inválidos.') });
  }
  return new Promise((resolve) => {
    let child: ProbeProcess;
    try { child = deps.spawnProbe(params.home); } catch {
      resolve({ authenticated: null, apps: null, error: localized('mcp.main.codexProbeStartFailed') });
      return;
    }
    const ctx = createReplyContext({ child, timeoutMs: deps.timeoutMs, includeApps: params.includeApps, resolve });
    try {
      child.onError?.(() => ctx.finish(TRANSPORT_FAILED));
      child.onExit(() => ctx.finish(localized('mcp.main.codexProbeExitedEarly')));
      child.onStdout((chunk) => receiveChunk(chunk, ctx));
      ctx.send(INIT, 'initialize', { clientInfo: { name: 'mage', version: '0.1.2' }, capabilities: { experimentalApi: true } });
    } catch { ctx.finish(TRANSPORT_FAILED); }
  });
}

interface ReplyContext {
  readonly state: { buffer: string; done: boolean; authenticated: boolean | null; apps: CodexAppView[]; cursors: Set<string> };
  readonly send: (id: string | undefined, method: string, payload: unknown) => void;
  readonly finish: (error: LocalizedText | null) => void;
  readonly includeApps: boolean;
}

function createReplyContext(params: { child: ProbeProcess; timeoutMs: number; includeApps: boolean; resolve: (value: CodexAccountMetadata) => void }): ReplyContext {
  const state: ReplyContext['state'] = { buffer: '', done: false, authenticated: null, apps: [], cursors: new Set() };
  const finish = (error: LocalizedText | null): void => {
    if (state.done) return;
    state.done = true;
    clearTimeout(timer);
    try { params.child.killTree(); } catch { error = localized('mcp.main.codexProbeCloseFailed'); }
    params.resolve({ authenticated: state.authenticated, apps: error === null ? state.apps : null, error });
  };
  const timer = setTimeout(() => finish(localized('mcp.main.codexProbeTimeout')), params.timeoutMs);
  const send: ReplyContext['send'] = (id, method, payload) => {
    if (state.done) return;
    try { params.child.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params: payload })); } catch {
      finish(TRANSPORT_FAILED);
    }
  };
  return { state, send, finish, includeApps: params.includeApps };
}

function receiveChunk(chunk: string, ctx: ReplyContext): void {
  if (ctx.state.done) return;
  ctx.state.buffer += chunk;
  const parts = ctx.state.buffer.split('\n');
  ctx.state.buffer = parts.pop() ?? '';
  for (const line of parts) {
    if (ctx.state.done) return;
    handleReply(line, ctx);
  }
}

// «Codex rechazó la consulta de Apps/de cuenta (código N)»: la consulta es otra frase de Mage dentro de esta.
function rejectedQuery(id: string, code: number): LocalizedText {
  const query = localized(id === APPS_ID ? 'mcp.main.codexProbeAppsQuery' : 'mcp.main.codexProbeAccountQuery');
  return localizedWithParts('mcp.main.codexProbeRejected', { code: String(code) }, { query });
}

function handleReply(line: string, ctx: ReplyContext): void {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return; } // Los avisos no JSON no son respuestas RPC.
  const parsed = REPLY.safeParse(raw);
  if (!parsed.success) return;
  const { id, error, result } = parsed.data;
  if (id !== INIT && id !== ACCOUNT_ID && id !== APPS_ID) return;
  if (error !== undefined) return ctx.finish(rejectedQuery(id, error.code));
  if (id === INIT) {
    ctx.send(undefined, 'initialized', undefined);
    return ctx.send(ACCOUNT_ID, 'account/read', {});
  }
  if (id === ACCOUNT_ID) {
    const account = ACCOUNT.safeParse(result);
    if (!account.success) return ctx.finish(localized('mcp.main.codexProbeAccountUnexpected'));
    ctx.state.authenticated = account.data.account?.type === 'chatgpt';
    if (!ctx.includeApps || !ctx.state.authenticated) return ctx.finish(null);
    return ctx.send(APPS_ID, 'app/list', { limit: APP_PAGE_SIZE });
  }
  appendApps(result, ctx);
}

function appendApps(result: unknown, ctx: ReplyContext): void {
  try {
    const page = parseCodexAppList(result);
    ctx.state.apps.push(...page.apps);
    if (page.nextCursor === null) return ctx.finish(null);
    if (ctx.state.cursors.has(page.nextCursor)) return ctx.finish(localized('mcp.main.codexProbeCursorRepeated'));
    ctx.state.cursors.add(page.nextCursor);
    ctx.send(APPS_ID, 'app/list', { limit: APP_PAGE_SIZE, cursor: page.nextCursor });
  } catch {
    ctx.finish(localized('mcp.main.codexProbeAppsUnexpected')); // Nunca citar el cuerpo externo.
  }
}
