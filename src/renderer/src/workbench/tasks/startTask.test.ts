import { describe, expect, it } from 'vitest';
import type { MentionResolution, MentionResolveParams } from '@shared/mentions';
import { classifySystemWrapper } from '@shared/systemWrappers';
import type { TaskSchedule } from '@shared/taskSchedule';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { launchTask, startTask, type StartTaskDeps } from './startTask';

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  name: 'Informe', schedule: null, goal: '  Haz el informe  ', language: 'es', provider: 'claude', accountDir: '/acc', folders: ['/work'], documents: [], capabilities: [], ...over,
});

// Registro completo hecho a partir del borrador (id 'task-9', resto con los valores por defecto).
const recordOf = (d: TaskDraft): TaskRecord => ({
  ...d, id: 'task-9', createdAtMs: 1, sessionId: null, conversationId: null, deliverables: [], verifiedAtMs: null, verdict: 'pending',
  enabled: true, nextRunAtMs: null, lastRun: null,
});

const okResolution =(text: string): MentionResolution => ({ text, attachments: [], outcomes: [] });

function fakeDeps(over: Partial<StartTaskDeps> = {}): { deps: StartTaskDeps; calls: string[]; sent: { text: string }[]; resolved: MentionResolveParams[]; attached: { tabId: string; taskId: string }[] } {
  const calls: string[] = [];
  const sent: { text: string }[] = [];
  const resolved: MentionResolveParams[] = [];
  const attached: { tabId: string; taskId: string }[] = [];
  const deps: StartTaskDeps = {
    createTask: async (d) => { calls.push('createTask'); return recordOf(d); },
    reloadTasks: async () => { calls.push('reloadTasks'); },
    activeAccountId: () => '/other',
    setActiveAccount: () => { calls.push('setActiveAccount'); },
    createConversation: async () => { calls.push('createConversation'); },
    activeTabId: () => 'tab1',
    attachTask: (tabId, taskId) => { calls.push('attachTask'); attached.push({ tabId, taskId }); },
    ensureSession: async () => { calls.push('ensureSession'); return 's1'; },
    tabMentionContext: () => ({ accountDir: '/acc', provider: 'claude' }),
    resolveMentions: async (params) => { calls.push('resolveMentions'); resolved.push(params); return okResolution(`[${params.refs.map((r) => r.relPath).join(',')}]`); },
    sendMessageToTab: async (_tabId, text) => { calls.push('send'); sent.push({ text }); },
    ...over,
  };
  return { deps, calls, sent, resolved, attached };
}

describe('startTask', () => {
  it('startTask_ordenDeLlamadas', async () => {
    const { deps, calls } = fakeDeps();
    const tabId = await startTask(draft({ documents: ['/work/a.pdf'] }), deps);
    expect(tabId).toBe('tab1');
    expect(calls).toEqual(['createTask', 'setActiveAccount', 'createConversation', 'attachTask', 'ensureSession', 'reloadTasks', 'resolveMentions', 'send']);
  });

  it('startTask_pasaElIdDeLaTareaAntesDeArrancar', async () => {
    const { deps, attached } = fakeDeps();
    await startTask(draft(), deps);
    expect(attached).toEqual([{ tabId: 'tab1', taskId: 'task-9' }]);
  });

  it('startTask_mismaCuenta_noCambiaCuenta', async () => {
    const { deps, calls } = fakeDeps({ activeAccountId: () => '/acc' });
    await startTask(draft(), deps);
    expect(calls).not.toContain('setActiveAccount');
  });

  it('startTask_documentosDeDosCarpetas_dosResoluciones', async () => {
    const { deps, resolved, sent } = fakeDeps();
    await startTask(draft({ documents: ['/work/a.pdf', 'C:\\docs\\b.txt', '/work/c.md'] }), deps);
    expect(resolved.map((r) => r.cwd)).toEqual(['/work', 'C:\\docs']);
    expect(resolved[0]?.refs.map((r) => r.relPath)).toEqual(['a.pdf', 'c.md']);
    expect(sent[0]?.text).toBe('Haz el informe[a.pdf,c.md][b.txt]');
  });

  it('startTask_documentoFalla_noEnvia', async () => {
    const failing = async (): Promise<MentionResolution> => ({ text: '', attachments: [], outcomes: [{ relPath: 'a.pdf', outcome: 'missing', kind: null }] });
    const { deps, sent } = fakeDeps({ resolveMentions: failing });
    await expect(startTask(draft({ documents: ['/work/a.pdf'] }), deps)).rejects.toThrow('/work/a.pdf');
    expect(sent).toHaveLength(0);
  });

  it('startTask_sinDocumentos_enviaSoloElObjetivo', async () => {
    const { deps, sent, resolved } = fakeDeps();
    await startTask(draft(), deps);
    expect(resolved).toHaveLength(0);
    expect(sent[0]?.text).toBe('Haz el informe');
  });
});

describe('launchTask', () => {
  const scheduled: TaskSchedule = { kind: 'daily', time: { hour: 9, minute: 0 }, timeZone: 'Europe/Madrid' };

  it('launchTask_programada_envuelveConElNombre', async () => {
    const { deps, sent } = fakeDeps();

    await launchTask(recordOf(draft({ schedule: scheduled })), deps);

    expect(classifySystemWrapper(sent[0]?.text ?? '')).toEqual({ kind: 'scheduled-task', name: 'Informe', body: 'Haz el informe' });
  });

  it('launchTask_sinProgramar_enviaElObjetivoTalCual', async () => {
    const { deps, sent } = fakeDeps();

    await launchTask(recordOf(draft()), deps);

    expect(sent[0]?.text).toBe('Haz el informe');
  });

  it('launchTask_noCreaRegistro', async () => {
    const { deps, calls } = fakeDeps();

    await launchTask(recordOf(draft()), deps);

    expect(calls).not.toContain('createTask');
  });
});
