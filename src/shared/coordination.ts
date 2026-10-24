// Contrato de la coordinación de sesiones (F2, §3.3 del diseño): identidades separadas, eventos con
// secuencia y la instantánea consultable de una sesión. Solo TIPOS y constantes: cruza el IPC y, más
// adelante, el protocolo del host local.
import type { PermissionRequest, SessionState } from './events';
import type { ElicitationRequest } from './elicitation';
import type { ImageAttachment } from './ipc';

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

// Estado de la sesión según la coordinación: `starting` hasta que el motor informa del suyo; `error` tras
// un error del motor (el turno ya no corre). En marcha = `running` o `requires_action`.
export type CoordinatedState = SessionState | 'starting' | 'restarting' | 'error';

// Mensaje en la cola de Mage (0.1.1 R2, punto 30; dueño: main desde F2.2). Con un turno en marcha el
// mensaje espera y sale como turno propio al acabar ese. `id` = el `commandId` de quien lo envió.
export interface QueuedMessage {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly ImageAttachment[];
}

// Respuesta a un envío (F2.2): lo tomó el motor, o espera en la cola. Un envío inválido se rechaza con
// error (como cualquier canal), no con un recibo. La finalización llega por eventos.
export type SendReceipt =
  | { readonly status: 'accepted'; readonly commandId: string }
  | { readonly status: 'queued'; readonly commandId: string };

// Respuesta a un permiso, una pregunta o una elicitation (F2.3): se contesta UNA vez, gane quien gane. La
// segunda respuesta a la misma petición no llega al motor: `rejected` con `already_answered` (también si la
// petición ya no está pendiente porque el motor la canceló o el turno acabó).
export type AnswerReceipt =
  | { readonly status: 'accepted' }
  | { readonly status: 'rejected'; readonly reason: 'already_answered' };

// Petición que espera respuesta del usuario: un permiso (o pregunta, que es un permiso con otra forma) o una
// elicitation de un servidor MCP.
export type PendingRequest =
  | { readonly kind: 'permission'; readonly request: PermissionRequest }
  | { readonly kind: 'elicitation'; readonly request: ElicitationRequest };

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
  readonly queue: readonly QueuedMessage[];
  readonly pending: readonly PendingRequest[];
}
