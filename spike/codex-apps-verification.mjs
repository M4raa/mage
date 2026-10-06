// Reintento de Apps: registra conteos y categorías, nunca respuestas de autenticación.
import { initialized, rpcSession, verificationContext, verificationDependencies, cleanupContext } from './codex-verification.mjs';
import { ACCOUNT_RESULT, APPS_RESULT, THREAD_RESULT, validatedResult } from './codex-wire.mjs';

const APP_PAGE_SIZE = 50;

export async function readApps(session, params) {
  let cursor = null;
  const seen = new Set();
  const counts = { count: 0, accessible: 0, enabled: 0, pages: 0 };
  do {
    const reply = await session.request('app/list', { limit: APP_PAGE_SIZE, ...params, ...(cursor === null ? {} : { cursor }) });
    if (reply.error) return { errorCode: reply.error.code, errorCategory: appErrorCategory(reply.error.message) };
    const page = validatedResult(reply, APPS_RESULT, 'app/list');
    counts.count += page.data.length;
    counts.accessible += page.data.filter((app) => app.isAccessible).length;
    counts.enabled += page.data.filter((app) => app.isEnabled).length;
    counts.pages += 1;
    cursor = page.nextCursor ?? null;
    if (cursor !== null && seen.has(cursor)) throw new Error('app/list: cursor repetido');
    seen.add(cursor);
  } while (cursor !== null);
  return { status: 'ok', ...counts };
}

function appErrorCategory(message) {
  if (typeof message !== 'string') return 'unknown';
  if (/auth|login|unauthori[sz]ed|token|credential/i.test(message)) return 'authentication';
  if (/network|connect|dns|timeout/i.test(message)) return 'network';
  return 'unknown';
}

async function measureApps(context, appsEnabled) {
  const args = appsEnabled ? ['-c', 'features.apps=true'] : [];
  const session = rpcSession({ ...context, args });
  try {
    await initialized(session);
    const accountReply = await session.request('account/read');
    if (accountReply.error) throw new Error(`account/read: código ${accountReply.error.code}`);
    if (validatedResult(accountReply, ACCOUNT_RESULT, 'account/read').account === null) throw new Error('Apps: falta cuenta en el perfil propio');
    console.log(JSON.stringify({ appsEnabledOverride: appsEnabled, forceRefetch: true, withThread: false,
      ...await readApps(session, { forceRefetch: true }) }));
    const reply = await session.request('thread/start', { cwd: context.workspace, model: 'gpt-6-luna', ephemeral: true });
    if (reply.error) throw new Error(`thread/start: código ${reply.error.code}`);
    const threadId = validatedResult(reply, THREAD_RESULT, 'thread/start').thread.id;
    console.log(JSON.stringify({ appsEnabledOverride: appsEnabled, forceRefetch: true, withThread: true,
      ...await readApps(session, { forceRefetch: true, threadId }) }));
  } finally { await session.close(); }
}

export async function verifyApps() {
  const context = verificationContext(await verificationDependencies());
  try {
    console.log(`${context.version}; cuenta aislada; turnos reales=0`);
    for (const appsEnabled of [false, true]) await measureApps(context, appsEnabled);
  } finally { cleanupContext(context); }
}
