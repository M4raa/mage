import { describe, expect, it } from 'vitest';
import { selectChatStatus, selectIsActiveTab } from './conversationSelectors';
import type { WorkbenchState } from './workbenchStore';

const state = (over: Partial<WorkbenchState>) => ({ statusByChat: {}, activeTabId: '', ...over }) as WorkbenchState;

describe('conversationSelectors', () => {
  it('selectChatStatus_conEstado_loDevuelve_ySinEstado_idle', () => {
    const s = state({ statusByChat: { a: 'streaming' } });

    expect([selectChatStatus(s, 'a'), selectChatStatus(s, 'b')]).toEqual(['streaming', 'idle']);
  });

  it('selectIsActiveTab_soloLaActiva', () => {
    const s = state({ activeTabId: 'a' });

    expect([selectIsActiveTab(s, 'a'), selectIsActiveTab(s, 'b')]).toEqual([true, false]);
  });

  it('selectores_otraConversacionCambia_mismoValorParaEsta', () => {
    // Lo que permite a Zustand no re-renderizar la fila: el valor de ESTA conversación no cambia.
    const before = state({ statusByChat: { a: 'idle', b: 'idle' }, activeTabId: 'b' });
    const after = state({ statusByChat: { a: 'idle', b: 'streaming' }, activeTabId: 'c' });

    expect([selectChatStatus(after, 'a'), selectIsActiveTab(after, 'a')]).toEqual([selectChatStatus(before, 'a'), selectIsActiveTab(before, 'a')]);
  });
});
