import type { ChatProject } from '@shared/settings';
import type { ConversationRow } from './conversationList';
import { isInside } from './chatInfoView';

export function projectForRow(
  row: ConversationRow,
  projects: readonly ChatProject[],
  sessionIdByChat: Readonly<Record<string, string>>,
): ChatProject | undefined {
  if (row.kind === 'tab' && row.tab.projectId !== undefined) {
    return projects.find((project) => project.id === row.tab.projectId);
  }
  const sessionId = row.kind === 'tab' ? sessionIdByChat[row.tab.id] ?? row.tab.resumeSessionId : row.item.sessionId;
  const cwd = row.kind === 'tab' ? row.tab.cwd : row.item.cwd;
  const assigned = projects.find((project) => sessionId !== undefined && project.sessionIds.includes(sessionId));
  if (assigned !== undefined) return assigned;
  return projects.find((project) => project.cwd !== null && isInside(cwd, project.cwd));
}
