// Contrato de la coordinación de sesiones (F2, §3.3 del diseño): identidades separadas, eventos con
// secuencia y la instantánea consultable de una sesión. Solo TIPOS y constantes: cruza el IPC y, más
// adelante, el protocolo del host local.
import type { SessionState } from './events';

// Identificador de la conversación PARA MAGE. Estable: es la clave de su entrada en
// `conversation-index.json`. Al crearse coincide con el id nativo de la primera sesión que la escribió
// (y, en las conversaciones anteriores a F2, con la clave que ya tenían); a partir de ahí no cambia aunque
// cambie su sesión nativa (`nativeRef`), por ejemplo al bifurcar o mover la conversación de cuenta.
export type ConversationId = string;

// Sesión nativa del proveedor que respalda la conversación: Claude `session_id`, Codex `threadId`, agy
// `conversation_id`. La cuenta es el config dir EFECTIVO (el perfil privado, si lo es).
export interface NativeSessionRef {
  readonly provider: string;
  readonly accountDir: string;
  readonly nativeId: string;
}

// Estado de la sesión según la coordinación: `starting` hasta que el motor informa del suyo.
export type CoordinatedState = SessionState | 'starting' | 'restarting';

// Proyección consultable de una sesión viva: lo que necesita un cliente que llega tarde o detecta un hueco
// en la secuencia. `conversationId`/`nativeRef` son null mientras el proveedor no ha dicho su id nativo (una
// conversación nueva de Codex o agy, hasta su `session_init`).
export interface ConversationSnapshot {
  readonly sessionId: string;
  readonly provider: string;
  readonly conversationId: ConversationId | null;
  readonly nativeRef: NativeSessionRef | null;
  readonly lastSeq: number;
  readonly state: CoordinatedState;
}
