import { describe, expect, it } from 'vitest';
import type { ChatProject } from '@shared/settings';
import type { ConversationRow } from './conversationList';
import { projectForRow } from './chatProjects';

const project = (over: Partial<ChatProject>): ChatProject => ({
  id: 'p1', name: 'Python', instructions: 'Experto en Python', cwd: null, sessionIds: [], ...over,
});
const row = (cwd: string, sessionId: string): ConversationRow => ({
  kind: 'history', item: { sessionId, cwd, title: 'Chat', configDir: '.claude', privacy: 'shared', updatedAtMs: 1, sizeBytes: 0, isScheduled: false },
});

describe('projectForRow', () => {
  it('agrupaLosChatsDeUnaAplicacionYNoLosDeUnaRutaConElMismoPrefijo', () => {
    const projects = [project({ cwd: 'C:/apps/Python' })];
    expect(projectForRow(row('C:/apps/Python/src', 's1'), projects, {})?.id).toBe('p1');
    expect(projectForRow(row('C:/apps/PythonViejo', 's2'), projects, {})).toBeUndefined();
  });

  it('laAsignacionExplicitaMandaSobreLaCarpeta', () => {
    const projects = [project({ cwd: 'C:/apps/Python' }), project({ id: 'p2', sessionIds: ['s1'] })];
    expect(projectForRow(row('C:/apps/Python', 's1'), projects, {})?.id).toBe('p2');
  });

  it('laPestanaNuevaPermaneceEnSuProyectoAntesDeTenerSesion', () => {
    const projects = [project({})];
    const open: ConversationRow = { kind: 'tab', tab: { id: 't1', accountId: '.claude', accountAlias: 'Claude', cwd: 'C:/scratch/1', model: 'sonnet', provider: 'claude', title: 'Nuevo chat', privacy: 'shared', projectId: 'p1' } };
    expect(projectForRow(open, projects, {})?.id).toBe('p1');
  });
});
