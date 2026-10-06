// Catálogo paginado: solo metadatos de modelos; nunca conserva respuestas de autenticación.
import { z } from 'zod';
import { initialized, rpcSession, verificationContext, verificationDependencies, cleanupContext } from './codex-verification.mjs';
import { ACCOUNT_RESULT, validatedResult } from './codex-wire.mjs';

const MODEL_PAGE_SIZE = 100;
const MODEL_PAGE = z.object({ data: z.array(z.object({ id: z.string(), model: z.string(), displayName: z.string(), hidden: z.boolean(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })) })), nextCursor: z.string().nullable() });

export async function readCatalog(session) {
  const models = [];
  let cursor = null;
  const seen = new Set();
  do {
    const reply = await session.request('model/list', { limit: MODEL_PAGE_SIZE, ...(cursor === null ? {} : { cursor }) });
    if (reply.error) throw new Error(`model/list: código ${reply.error.code}`);
    const page = validatedResult(reply, MODEL_PAGE, 'model/list');
    models.push(...page.data.filter((model) => !model.hidden).map((model) => ({
      id: model.model, label: model.displayName, supportedEfforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    })));
    cursor = page.nextCursor;
    if (cursor !== null && seen.has(cursor)) throw new Error('model/list: cursor repetido');
    seen.add(cursor);
  } while (cursor !== null);
  return models;
}

export async function verifyCatalog() {
  const context = verificationContext(await verificationDependencies());
  const session = rpcSession(context);
  try {
    console.log(context.version);
    await initialized(session);
    const reply = await session.request('account/read');
    if (reply.error) throw new Error(`account/read: código ${reply.error.code}`);
    const account = validatedResult(reply, ACCOUNT_RESULT, 'account/read').account;
    console.log(`Cuenta autenticada=${account !== null}; tipo=${account?.type ?? 'ninguno'}; turnos reales=0`);
    console.log(JSON.stringify(await readCatalog(session), null, 2));
  } finally {
    await session.close();
    cleanupContext(context);
  }
}
