import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IpcChannel } from '@shared/ipc';
import type { AnswerReceipt } from '@shared/coordination';
import { parseSessionInput, SESSION_ID_SCHEMA } from '@shared/sessionInput';
import type { WidgetPrefs } from '@shared/widget';
import type { IpcRegister } from '../coordination/sessionIpc';
import type { SessionCoordinator } from '../coordination/sessionCoordinator';
import { decideWidgetAnswer } from './widgetAnswer';
import { WIDGET_PREFS_PATCH_SCHEMA, type WidgetPrefsStore } from './widgetPrefsStore';

// IPC del widget acompañante (F9): sale de `index.ts` con sus dependencias inyectadas para probarlo sin Electron.
// El widget habla con las sesiones A TRAVÉS de main: aquí se valida la entrada, se comprueba que quien llama es
// la ventana del widget y se delega en el coordinador, que garantiza la respuesta única.

export interface WidgetIpcDeps {
  readonly handle: IpcRegister;
  readonly on: (channel: string, listener: (event: IpcMainEvent, arg: unknown) => void) => void;
  readonly sessions: Pick<SessionCoordinator, 'snapshot' | 'answerPermission' | 'interrupt' | 'ownerOf'>;
  readonly prefs: Pick<WidgetPrefsStore, 'load' | 'update'>;
  readonly isWidget: (webContentsId: number) => boolean;
  readonly openSession: (sessionId: string) => void; // lo implementa index.ts
  readonly onPrefsChanged: (prefs: WidgetPrefs) => void; // lo implementa index.ts
}

const MAX_WIDGET_OPTION_CHARS = 1_000;

export const WIDGET_ANSWER_SCHEMA = z.object({
  sessionId: SESSION_ID_SCHEMA,
  requestId: SESSION_ID_SCHEMA,
  choice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('allow') }).strict(),
    z.object({ kind: z.literal('deny') }).strict(),
    z.object({ kind: z.literal('option'), label: z.string().min(1).max(MAX_WIDGET_OPTION_CHARS) }).strict(),
  ]),
}).strict();

const REJECTED: AnswerReceipt = { status: 'rejected', reason: 'already_answered' };

export function registerWidgetIpc(deps: WidgetIpcDeps): void {
  const { handle, on, sessions } = deps;
  // Solo la ventana del widget puede usar estos canales (excepto las preferencias).
  const requireWidget = (event: IpcMainEvent | IpcMainInvokeEvent, channel: string): void => {
    if (!deps.isWidget(event.sender.id)) throw new Error(`${channel}: solo lo puede usar la ventana del widget`);
  };

  handle(IpcChannel.WidgetAnswer, (event, arg) => {
    requireWidget(event, IpcChannel.WidgetAnswer);
    const answer = parseSessionInput(WIDGET_ANSWER_SCHEMA, arg, IpcChannel.WidgetAnswer);
    if (sessions.ownerOf(answer.sessionId) === undefined) return REJECTED; // respuesta tardía: la sesión ya no existe
    const result = decideWidgetAnswer(sessions.snapshot(answer.sessionId).pending, answer);
    if (result.kind === 'rejected') return REJECTED;
    return sessions.answerPermission(answer.sessionId, answer.requestId, result.decision);
  });
  handle(IpcChannel.WidgetInterrupt, (event, arg) => {
    requireWidget(event, IpcChannel.WidgetInterrupt);
    const sessionId = parseSessionInput(SESSION_ID_SCHEMA, arg, IpcChannel.WidgetInterrupt);
    if (sessions.ownerOf(sessionId) === undefined) return undefined; // la sesión ya no existe
    // `interrupt` del coordinador VACÍA la cola y la devuelve a la pestaña: desde el widget esos mensajes se perderían.
    if (sessions.snapshot(sessionId).queue.length > 0) {
      throw new Error(`Con mensajes en cola, detén la sesión desde Mage: ${sessionId}`);
    }
    sessions.interrupt(sessionId);
    return undefined;
  });
  on(IpcChannel.WidgetOpenSession, (event, arg) => {
    requireWidget(event, IpcChannel.WidgetOpenSession);
    deps.openSession(parseSessionInput(SESSION_ID_SCHEMA, arg, IpcChannel.WidgetOpenSession));
  });
  handle(IpcChannel.WidgetGetPrefs, () => deps.prefs.load());
  handle(IpcChannel.WidgetSetPrefs, (_event, arg) => {
    const patch = parseSessionInput(WIDGET_PREFS_PATCH_SCHEMA, arg, IpcChannel.WidgetSetPrefs);
    const prefs = deps.prefs.update(patch);
    deps.onPrefsChanged(prefs);
    return prefs;
  });
}
