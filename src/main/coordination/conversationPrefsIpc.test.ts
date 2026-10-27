import { describe, expect, it } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { ConversationIndexStore } from '../state/conversationIndexStore';
import { registerConversationPrefsIpc } from './conversationPrefsIpc';

type Listener = (event: IpcMainInvokeEvent, arg: unknown) => unknown;

// Índice en memoria y una sesión de Codex viva: id de Mage `s-mage`, hilo nativo `thread-1`.
function setup() {
  let content = '';
  const index = new ConversationIndexStore({
    filePath: '/u/conversation-index.json', exists: () => content.length > 0, readFile: () => content,
    writeFile: (_path, data) => { content = data; }, rename: () => undefined, removeFile: () => undefined, tempSuffix: () => 'x',
  });
  index.resolveConversation({ provider: 'codex', accountDir: '/u/.codex', nativeId: 'thread-1' });
  const handlers = new Map<string, Listener>();
  registerConversationPrefsIpc({
    handle: (channel, listener) => { handlers.set(channel, listener); },
    index: () => index,
    coordinator: { conversationIdOf: (sessionId) => (sessionId === 's-mage' ? 'thread-1' : null) },
  });
  const invoke = (channel: string, arg: unknown) => handlers.get(channel)?.({} as IpcMainInvokeEvent, arg);
  return { invoke };
}

describe('preferencias por conversación con identidades separadas (F2.1)', () => {
  it('save_conIdDeSesionDeMage_seLeeAlReabrirPorElHilo', () => {
    // El renderer guarda con el id de la sesión viva (para Codex, el de Mage) y reabre del historial con el
    // id del hilo: antes eran dos claves distintas y las preferencias no se recuperaban.
    const { invoke } = setup();

    invoke(IpcChannel.ConversationPrefsSave, { sessionId: 's-mage', prefs: { model: 'gpt-6-luna', effort: 'low' } });

    expect(invoke(IpcChannel.ConversationPrefsLoad, 'thread-1')).toEqual({ model: 'gpt-6-luna', effort: 'low' });
  });

  it('load_conIdDeSesionDeMage_leeLaConversacion', () => {
    const { invoke } = setup();
    invoke(IpcChannel.ConversationPrefsSave, { sessionId: 'thread-1', prefs: { model: 'gpt-6-luna' } });

    expect(invoke(IpcChannel.ConversationPrefsLoad, 's-mage')).toEqual({ model: 'gpt-6-luna' });
  });

  it('save_idSinSesionViva_usaElIdTalCual', () => {
    const { invoke } = setup();

    invoke(IpcChannel.ConversationPrefsSave, { sessionId: 'otra', prefs: { model: 'haiku' } });

    expect(invoke(IpcChannel.ConversationPrefsLoad, 'otra')).toEqual({ model: 'haiku' });
  });
});
