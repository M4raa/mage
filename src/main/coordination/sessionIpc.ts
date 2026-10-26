import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '@shared/ipc';
import type { CreateSessionParams, CreateSessionResult, ImageAttachment } from '@shared/ipc';
import {
  ANSWER_PERMISSION_SCHEMA,
  parseSessionInput,
  QUEUED_MESSAGE_SCHEMA,
  SEND_MESSAGE_SCHEMA,
  SESSION_ID_SCHEMA,
  SET_EFFORT_SCHEMA,
  SET_MODEL_SCHEMA,
  SET_PERMISSION_MODE_SCHEMA,
  STOP_TASK_SCHEMA,
} from '@shared/sessionInput';
import { ELICITATION_ANSWER_SCHEMA } from '@shared/elicitation';
import type { SessionManager } from '../engine/sessionManager';
import type { SessionCoordinator } from './sessionCoordinator';

// Registro IPC del dominio de sesiones (F2, H7 de la devolución 13): sale de `index.ts` con sus
// dependencias inyectadas para poder probarlo sin Electron. Solo enruta: crear una sesión (con su frontera
// de confianza) lo decide quien inyecta `createSession`; enviar, interrumpir, la cola, contestar, parar y la
// instantánea pasan por la coordinación (dueña de la cola desde F2.2 y de las peticiones pendientes desde
// F2.3), y el resto va al gestor de sesiones tal cual.
//
// FRONTERA DE ENTRADA (F2.6, H3 de la devolución 14): toda entrada se valida con su esquema Zod ANTES de llegar
// al coordinador (antes era un cast sin más: `decision.updatedInput` llegaba al CLI), y toda orden sobre una
// sesión comprueba que quien la manda es su dueño —la ventana que la creó— o la ventana principal.

// `ipcMain.handle` o un doble de pruebas. Cada canal recibe UN argumento, que es lo que usa el preload.
export type IpcRegister = (channel: string, listener: (event: IpcMainInvokeEvent, arg: unknown) => unknown) => void;

export type SessionCommands = Pick<SessionManager,
  'setPermissionMode' | 'setModel' | 'setEffort' | 'stopTask'>;

export interface SessionIpcDeps {
  readonly handle: IpcRegister;
  readonly sessions: SessionCommands;
  readonly coordinator: Pick<SessionCoordinator,
    'send' | 'interrupt' | 'removeQueued' | 'takeQueue' | 'answerPermission' | 'answerElicitation' | 'stop' | 'close' | 'snapshot'>;
  readonly createSession: (event: IpcMainInvokeEvent, params: CreateSessionParams) => CreateSessionResult;
  readonly validateAttachments: (attachments: readonly ImageAttachment[] | undefined) => readonly ImageAttachment[];
  // Carpeta scratch AISLADA por conversación (subdir único y vacío), ya creada y canonizada.
  readonly newScratchDir: () => string;
  // ¿Puede el webContents `senderId` dar órdenes a esta sesión? (su dueño o la ventana principal). Una sesión
  // que la coordinación no sigue se deja pasar: el coordinador contesta «Sesion inexistente», que es la
  // ausencia idempotente que ya esperan los clientes.
  readonly canControl: (senderId: number, sessionId: string) => boolean;
}

export function registerSessionIpc(deps: SessionIpcDeps): void {
  const { handle, coordinator } = deps;
  // Valida la entrada del canal y comprueba que el emisor controla la sesión que nombra.
  const authorize = <T extends { readonly sessionId: string }>(event: IpcMainInvokeEvent, channel: string, value: T): T => {
    if (!deps.canControl(event.sender.id, value.sessionId)) {
      throw new Error(`${channel}: esta ventana no controla la sesión ${value.sessionId}`);
    }
    return value;
  };
  const authorizeId = (event: IpcMainInvokeEvent, channel: string, arg: unknown): string =>
    authorize(event, channel, { sessionId: parseSessionInput(SESSION_ID_SCHEMA, arg, channel) }).sessionId;

  handle(IpcChannel.SessionCreate, (event, params) => deps.createSession(event, params as CreateSessionParams));
  // Los adjuntos se validan también AQUÍ (el renderer valida por cortesía; esta es la frontera de verdad).
  handle(IpcChannel.SessionSendMessage, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionSendMessage, parseSessionInput(SEND_MESSAGE_SCHEMA, arg, IpcChannel.SessionSendMessage));
    return coordinator.send({ ...params, attachments: deps.validateAttachments(params.attachments) });
  });
  handle(IpcChannel.SessionAnswerPermission, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionAnswerPermission, parseSessionInput(ANSWER_PERMISSION_SCHEMA, arg, IpcChannel.SessionAnswerPermission));
    return coordinator.answerPermission(params.sessionId, params.requestId, params.decision);
  });
  handle(IpcChannel.SessionAnswerElicitation, (event, arg) =>
    coordinator.answerElicitation(authorize(event, IpcChannel.SessionAnswerElicitation, parseSessionInput(ELICITATION_ANSWER_SCHEMA, arg, IpcChannel.SessionAnswerElicitation))));
  handle(IpcChannel.SessionInterrupt, (event, sessionId) => coordinator.interrupt(authorizeId(event, IpcChannel.SessionInterrupt, sessionId)));
  handle(IpcChannel.SessionQueueRemove, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionQueueRemove, parseSessionInput(QUEUED_MESSAGE_SCHEMA, arg, IpcChannel.SessionQueueRemove));
    return coordinator.removeQueued(params.sessionId, params.messageId);
  });
  handle(IpcChannel.SessionQueueTake, (event, sessionId) => coordinator.takeQueue(authorizeId(event, IpcChannel.SessionQueueTake, sessionId)));
  registerSessionOptions(deps, authorize);
  handle(IpcChannel.SessionStop, (event, sessionId) => coordinator.stop(authorizeId(event, IpcChannel.SessionStop, sessionId)));
  handle(IpcChannel.SessionClose, (event, sessionId) => coordinator.close(authorizeId(event, IpcChannel.SessionClose, sessionId)));
  handle(IpcChannel.SessionSnapshot, (event, sessionId) => coordinator.snapshot(authorizeId(event, IpcChannel.SessionSnapshot, sessionId)));
  handle(IpcChannel.SessionGetScratchDir, () => deps.newScratchDir());
}

type Authorize = <T extends { readonly sessionId: string }>(event: IpcMainInvokeEvent, channel: string, value: T) => T;

function registerSessionOptions({ handle, sessions }: SessionIpcDeps, authorize: Authorize): void {
  handle(IpcChannel.SessionSetPermissionMode, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionSetPermissionMode, parseSessionInput(SET_PERMISSION_MODE_SCHEMA, arg, IpcChannel.SessionSetPermissionMode));
    sessions.setPermissionMode(params.sessionId, params.mode);
  });
  handle(IpcChannel.SessionSetModel, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionSetModel, parseSessionInput(SET_MODEL_SCHEMA, arg, IpcChannel.SessionSetModel));
    sessions.setModel(params.sessionId, params.model);
  });
  handle(IpcChannel.SessionSetEffort, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionSetEffort, parseSessionInput(SET_EFFORT_SCHEMA, arg, IpcChannel.SessionSetEffort));
    sessions.setEffort(params.sessionId, params.effort);
  });
  handle(IpcChannel.SessionStopTask, (event, arg) => {
    const params = authorize(event, IpcChannel.SessionStopTask, parseSessionInput(STOP_TASK_SCHEMA, arg, IpcChannel.SessionStopTask));
    sessions.stopTask(params.sessionId, params.taskId);
  });
}
