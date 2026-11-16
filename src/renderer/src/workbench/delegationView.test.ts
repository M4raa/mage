import { describe, expect, it } from 'vitest';
import { delegationCardFrom, findSubsession } from './delegationView';
import { isChatBlock, isActivityStep } from './chatVisibility';
import type { AccountConversation } from './sidebarModel';
import type { Block, Tab } from './types';

const tab = (over: Partial<Tab>): Tab => ({ id: 't1', accountId: 'a', accountAlias: 'a', cwd: '/p', model: 'm', provider: 'claude', title: 'x', ...over });
const entry = (sessionId: string): AccountConversation => ({
  item: { sessionId, configDir: 'a', cwd: '/p', title: 'h', updatedAtMs: 1, sizeBytes: 1, isScheduled: false },
  accountId: 'a',
});
const toolBlock = (over: Record<string, unknown>): Block => ({
  kind: 'tool', id: 'b1', toolUseId: 'u1', tool: 'mcp__mage__mage_create_session', toolClass: 'other', command: '', meta: '', isError: false,
  output: [], filePath: null, diff: null, writtenContent: null, artifact: null, artifactDraft: null, parentToolUseId: null, ...over,
} as unknown as Block);

describe('findSubsession', () => {
  it('findSubsession_pestanaAbierta_devuelveLaPestana', () => {
    const target = findSubsession('c-1', { tabs: [tab({ id: 't9', resumeSessionId: 'c-1' })], sessionIdByChat: {}, history: [entry('c-1')] });

    expect(target).toEqual({ kind: 'tab', tabId: 't9' });
  });

  it('findSubsession_soloEnHistorial_devuelveLaFila', () => {
    const target = findSubsession('c-1', { tabs: [], sessionIdByChat: {}, history: [entry('c-1')] });

    expect(target).toMatchObject({ kind: 'history', entry: { item: { sessionId: 'c-1' } } });
  });

  it('findSubsession_enNingunSitio_missing', () => {
    expect(findSubsession('c-1', { tabs: [], sessionIdByChat: {}, history: [] })).toEqual({ kind: 'missing' });
  });
});

describe('delegationCardFrom', () => {
  it('delegationCardFrom_conResultado_tarjetaEnElChatYNoEnActividad', () => {
    const block = toolBlock({ delegation: { title: 'Hola 1', conversationId: 'c-1' } });

    expect(delegationCardFrom(block)).toEqual({ title: 'Hola 1', conversationId: 'c-1', blockId: 'b1' });
    expect(isChatBlock(block)).toBe(true);
    expect(isActivityStep(block)).toBe(false);
  });

  it('delegationCardFrom_sinResultado_cajaDeHerramientaDeSiempre', () => {
    const block = toolBlock({ delegation: null, delegationDraft: { title: 'Hola 1' } });

    expect(delegationCardFrom(block)).toBeNull();
    expect(isChatBlock(block)).toBe(false);
    expect(isActivityStep(block)).toBe(true);
  });
});
