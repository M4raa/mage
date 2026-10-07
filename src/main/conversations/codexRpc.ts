import type { ProbeProcess } from '../engine/modelProbe';

// Llamadas de UN SOLO USO al app-server de Codex de una cuenta: arranca, se presenta, hace la petición y se cierra.
// Hoy solo `thread/delete` (quitar la conversación de origen al migrarla): MEDIDO con codex-cli 0.160.0
// (`spike/codex-copy-rollout-spike.mjs`), borra el rollout del CODEX_HOME y no hace falta sesión iniciada.

export interface CodexRpcDeps {
  readonly spawnProbe: (home: string) => ProbeProcess;
  readonly timeoutMs: number;
}

const INIT_ID = 'mage-rpc-init';
const CALL_ID = 'mage-rpc-call';
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export function codexThreadDelete(deps: CodexRpcDeps, home: string, threadId: string): Promise<void> {
  if (home.trim().length === 0 || !THREAD_ID_PATTERN.test(threadId)) {
    return Promise.reject(new Error(`Parametros invalidos para borrar un hilo de Codex: home=${JSON.stringify(home)} hilo=${JSON.stringify(threadId)}`));
  }
  return new Promise((resolve, reject) => {
    const child = deps.spawnProbe(home);
    let buffer = '';
    let done = false;
    const finish = (error: Error | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.killTree();
      if (error === null) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => finish(new Error(`Codex no respondio a thread/delete dentro de ${deps.timeoutMs} ms`)), deps.timeoutMs);
    const send = (message: object): void => child.writeLine(JSON.stringify({ jsonrpc: '2.0', ...message }));
    const onLine = (line: string): void => {
      const reply = parseReply(line);
      if (reply === null) return;
      if (reply.id === INIT_ID) {
        send({ method: 'initialized' });
        send({ id: CALL_ID, method: 'thread/delete', params: { threadId } });
      } else if (reply.id === CALL_ID) {
        finish(reply.error === undefined ? null : new Error(`Codex rechazo thread/delete: ${String(reply.error.message ?? 'sin motivo')}`));
      }
    };
    child.onError?.(() => finish(new Error('Fallo el transporte con el CLI de Codex')));
    child.onExit(() => finish(new Error('El CLI de Codex termino antes de responder a thread/delete')));
    child.onStdout((chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    send({ id: INIT_ID, method: 'initialize', params: { clientInfo: { name: 'mage', version: '0.1.2' }, capabilities: { experimentalApi: true } } });
  });
}

interface Reply {
  readonly id?: unknown;
  readonly error?: { readonly message?: unknown };
}

// Los avisos que no son JSON (o no son una respuesta) se ignoran: el app-server mezcla notificaciones con respuestas.
function parseReply(line: string): Reply | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Reply) : null;
  } catch {
    return null;
  }
}
