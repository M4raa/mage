import type { ConversationLockRef } from '@shared/conversationLock';
import type { LogFn } from '../debug/logBus';
import type { HeartbeatResult } from './conversationLocks';

// Un tick del latido de los locks (#55), fuera de `index.ts` para poder probarlo. NUNCA deja escapar una excepción: lo
// llama un `setInterval` y en main no hay manejador global, así que un error aquí sería un error no controlado (H1 de
// la devolución 17). Un fallo de E/S al renovar una conversación se registra y esa conversación sigue siendo de esta
// instancia: se reintenta en el siguiente latido.

export interface LockHeartbeatDeps {
  readonly heartbeat: () => HeartbeatResult;
  readonly log: LogFn;
  // Avisa a las ventanas de una conversación que tomó otra instancia (pasa a solo lectura).
  readonly notifyLost: (ref: ConversationLockRef) => void;
}

export function runLockHeartbeatTick(deps: LockHeartbeatDeps): void {
  try {
    report(deps, deps.heartbeat());
  } catch (err) {
    deps.log('error', 'El latido de los bloqueos de conversación falló', { error: err instanceof Error ? err.message : String(err) });
  }
}

function report(deps: LockHeartbeatDeps, result: HeartbeatResult): void {
  for (const { ref, error } of result.failed) {
    deps.log('warn', 'No se pudo renovar el bloqueo de una conversación; se reintenta en el siguiente latido', { provider: ref.provider, nativeId: ref.nativeId, error: error.message });
  }
  for (const ref of result.lost) {
    deps.log('warn', 'Otra instancia de Mage tomó el control de una conversación de esta', { provider: ref.provider, nativeId: ref.nativeId });
    deps.notifyLost(ref);
  }
}
