import { describe, expect, it, vi } from 'vitest';
import type { ConversationSnapshot } from '@shared/coordination';
import type { SequencedSessionEvent, SessionListener } from '../coordination/sessionCoordinator';
import type { HostSessionRecord } from '../state/conversationIndexStore';
import { HostOwnership } from './hostOwnership';

const RECORD: HostSessionRecord = { accountId: '/h/.claude-inval', provider: 'claude', model: 'claude-haiku-4-5' };

function setup(snapshotConversation: string | null) {
  let listener: SessionListener | undefined;
  const unsubscribe = vi.fn();
  const coordinator = {
    subscribe: vi.fn((_id: string, l: SessionListener) => {
      listener = l;
      return { snapshot: { conversationId: snapshotConversation } as ConversationSnapshot, unsubscribe };
    }),
  };
  const index = { recordHostSession: vi.fn() };
  const log = vi.fn();
  const ownership = new HostOwnership({ coordinator, index, log });
  return { ownership, index, log, unsubscribe, listener: () => listener as SessionListener };
}

const eventOf = (conversationId: string): SequencedSessionEvent => ({ conversationId }) as SequencedSessionEvent;

describe('HostOwnership', () => {
  it('watch_conversationKnown_recordsAtOnce', () => {
    const { ownership, index } = setup('c1');

    ownership.watch('s1', RECORD);

    expect(index.recordHostSession).toHaveBeenCalledWith('c1', RECORD);
  });

  it('watch_conversationLater_recordsOnFirstEvent', () => {
    const { ownership, index, listener } = setup(null);
    ownership.watch('s1', RECORD);
    expect(index.recordHostSession).not.toHaveBeenCalled();

    listener().sink(eventOf('c1'));

    expect(index.recordHostSession).toHaveBeenCalledTimes(1);
    expect(index.recordHostSession).toHaveBeenCalledWith('c1', RECORD);
  });

  it('sink_sameConversationAgain_recordsOnce', () => {
    const { ownership, index, listener } = setup('c1');
    ownership.watch('s1', RECORD);

    listener().sink(eventOf('c1'));

    expect(index.recordHostSession).toHaveBeenCalledTimes(1);
  });

  it('sink_conversationChanges_recordsAgain', () => {
    const { ownership, index, listener } = setup('c1');
    ownership.watch('s1', RECORD);

    listener().sink(eventOf('c2'));

    expect(index.recordHostSession).toHaveBeenCalledTimes(2);
    expect(index.recordHostSession).toHaveBeenLastCalledWith('c2', RECORD);
  });

  it('updateOptions_knownConversation_savesMergedRecord', () => {
    const { ownership, index } = setup('c1');
    ownership.watch('s1', RECORD);

    ownership.updateOptions('s1', { model: 'claude-sonnet-4-5' });

    expect(index.recordHostSession).toHaveBeenLastCalledWith('c1', { ...RECORD, model: 'claude-sonnet-4-5' });
  });

  it('updateOptions_unknownSession_noCall', () => {
    const { ownership, index } = setup('c1');

    ownership.updateOptions('nope', { model: 'x' });

    expect(index.recordHostSession).not.toHaveBeenCalled();
  });

  it('onClosed_unsubscribesAndWatchCountZero', () => {
    const { ownership, unsubscribe, listener } = setup('c1');
    ownership.watch('s1', RECORD);
    expect(ownership.watchCount('s1')).toBe(1);

    listener().onClosed();

    expect(unsubscribe).toHaveBeenCalled();
    expect(ownership.watchCount('s1')).toBe(0);
  });

  it('recordFails_logsWarnWithoutThrowing', () => {
    const { ownership, index, log } = setup('c1');
    index.recordHostSession.mockImplementation(() => {
      throw new Error('EBUSY');
    });

    expect(() => ownership.watch('s1', RECORD)).not.toThrow();

    expect(log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ error: 'EBUSY' }));
  });

  it('watch_sameSessionTwice_throws', () => {
    const { ownership } = setup('c1');
    ownership.watch('s1', RECORD);

    expect(() => ownership.watch('s1', RECORD)).toThrow('ya está vigilada');
  });
});
