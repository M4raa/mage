import { describe, expect, it } from 'vitest';
import { AdoptableSessions, type AdoptableEntry } from './adoptableSessions';

const entry = (sessionId: string): AdoptableEntry => ({
  sessionId, provider: 'claude', accountId: '/acc', configDir: '/acc', cwd: '/p', model: 'haiku', origin: 'terminal', createdBy: null,
});
const live = () => ({ conversationId: 'c1', nativeId: 'n1' });

describe('AdoptableSessions', () => {
  it('add_thenList_returnsWithLiveIds', () => {
    const sessions = new AdoptableSessions();
    sessions.add(entry('s1'));

    expect(sessions.list(live)).toEqual([{ ...entry('s1'), conversationId: 'c1', nativeId: 'n1' }]);
  });

  it('add_duplicateSessionId_throwsWithId', () => {
    const sessions = new AdoptableSessions();
    sessions.add(entry('s1'));

    expect(() => sessions.add(entry('s1'))).toThrow(/s1/);
  });

  it('list_deadSession_removedAndNotListed', () => {
    const sessions = new AdoptableSessions();
    sessions.add(entry('s1'));
    sessions.add(entry('s2'));

    const listed = sessions.list((id) => (id === 's1' ? null : live()));

    expect(listed.map((s) => s.sessionId)).toEqual(['s2']);
    expect(sessions.has('s1')).toBe(false);
  });

  it('remove_unknown_returnsFalse', () => {
    expect(new AdoptableSessions().remove('nope')).toBe(false);
  });

  it('list_keepsInsertionOrder', () => {
    const sessions = new AdoptableSessions();
    for (const id of ['b', 'a', 'c']) sessions.add(entry(id));

    expect(sessions.list(live).map((s) => s.sessionId)).toEqual(['b', 'a', 'c']);
  });
});
