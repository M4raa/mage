import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '@shared/ipc';
import type {
  AnswerPermissionParams,
  CreateSessionParams,
  CreateSessionResult,
  ImageAttachment,
  SendMessageParams,
  SetEffortParams,
  SetModelParams,
  SetPermissionModeParams,
  StopTaskParams,
} from '@shared/ipc';
import { ELICITATION_ANSWER_SCHEMA } from '@shared/elicitation';
import type { SessionManager } from '../engine/sessionManager';

// Registro IPC del dominio de sesiones (F2, H7 de la devolución 13): sale de `index.ts` con sus
// dependencias inyectadas para poder probarlo sin Electron. Solo enruta: crear una sesión (con su frontera
// de confianza) lo decide quien inyecta `createSession`; el resto va al gestor de sesiones tal cual.

// `ipcMain.handle` o un doble de pruebas. Cada canal recibe UN argumento, que es lo que usa el preload.
export type IpcRegister = (channel: string, listener: (event: IpcMainInvokeEvent, arg: unknown) => unknown) => void;

export type SessionCommands = Pick<SessionManager,
  'sendMessage' | 'answerPermission' | 'answerElicitation' | 'interrupt' | 'setPermissionMode' | 'setModel' | 'setEffort' | 'stopTask' | 'stop'>;

export interface SessionIpcDeps {
  readonly handle: IpcRegister;
  readonly sessions: SessionCommands;
  readonly createSession: (event: IpcMainInvokeEvent, params: CreateSessionParams) => CreateSessionResult;
  readonly validateAttachments: (attachments: readonly ImageAttachment[] | undefined) => readonly ImageAttachment[];
  // Carpeta scratch AISLADA por conversación (subdir único y vacío), ya creada y canonizada.
  readonly newScratchDir: () => string;
}

export function registerSessionIpc(deps: SessionIpcDeps): void {
  const { handle, sessions } = deps;
  handle(IpcChannel.SessionCreate, (event, params) => deps.createSession(event, params as CreateSessionParams));
  // Los adjuntos se validan también AQUÍ (el renderer valida por cortesía; esta es la frontera de verdad).
  handle(IpcChannel.SessionSendMessage, (_e, arg) => {
    const params = arg as SendMessageParams;
    sessions.sendMessage(params.sessionId, params.text, deps.validateAttachments(params.attachments));
  });
  handle(IpcChannel.SessionAnswerPermission, (_e, arg) => {
    const params = arg as AnswerPermissionParams;
    sessions.answerPermission(params.sessionId, params.requestId, params.decision);
  });
  handle(IpcChannel.SessionAnswerElicitation, (_e, arg) => sessions.answerElicitation(ELICITATION_ANSWER_SCHEMA.parse(arg)));
  handle(IpcChannel.SessionInterrupt, (_e, sessionId) => sessions.interrupt(sessionId as string));
  registerSessionOptions(deps);
  handle(IpcChannel.SessionStop, (_e, sessionId) => sessions.stop(sessionId as string));
  handle(IpcChannel.SessionGetScratchDir, () => deps.newScratchDir());
}

function registerSessionOptions({ handle, sessions }: SessionIpcDeps): void {
  handle(IpcChannel.SessionSetPermissionMode, (_e, arg) => {
    const params = arg as SetPermissionModeParams;
    sessions.setPermissionMode(params.sessionId, params.mode);
  });
  handle(IpcChannel.SessionSetModel, (_e, arg) => {
    const params = arg as SetModelParams;
    sessions.setModel(params.sessionId, params.model);
  });
  handle(IpcChannel.SessionSetEffort, (_e, arg) => {
    const params = arg as SetEffortParams;
    sessions.setEffort(params.sessionId, params.effort);
  });
  handle(IpcChannel.SessionStopTask, (_e, arg) => {
    const params = arg as StopTaskParams;
    sessions.stopTask(params.sessionId, params.taskId);
  });
}
