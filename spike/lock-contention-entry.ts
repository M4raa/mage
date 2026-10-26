// Entrada del bundle de la sonda de contención del latido (`lock-contention.mjs`, H1 de la devolución 17): el código
// de producción, sin copiar nada.
export { ConversationLocks } from '../src/main/locks/conversationLocks';
export { lockFileName, nodeLockFs } from '../src/main/locks/conversationLockEnv';
export { runLockHeartbeatTick } from '../src/main/locks/conversationLockHeartbeat';
export { sleepSync } from '../src/main/os/renameRetry';
