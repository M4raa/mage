import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '@shared/tasks';
import type { SidebarRow } from '../sidebarModel';
import type { Block, Tab } from '../types';
import {
  buildTaskIndex, canStartTask, declaredDeliverablesOf, isTaskRow, planOf, shouldVerify, taskOfTab, taskPhase, taskTitle,
} from './taskView';

const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't1', goal: 'g', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/f'], documents: [], capabilities: [],
  createdAtMs: 0, sessionId: null, conversationId: null, deliverables: [], verifiedAtMs: null, verdict: 'pending', ...over,
});
const agent = (id: string, text: string): Block => ({ kind: 'agent', id, runs: [{ code: false, text }], streaming: false });
const tabOf = (over: Partial<Tab> = {}): Tab => ({ id: 'tab1', provider: 'claude', ...over }) as Tab;
const fence = (info: string, body: string): string => `\`\`\`${info}\n${body}\n\`\`\``;

describe('taskOfTab', () => {
  it('taskOfTab_porSessionVivo', () => {
    const t = task({ sessionId: 's1' });
    expect(taskOfTab([t], tabOf(), 's1')).toBe(t);
  });
  it('taskOfTab_porConversationId', () => {
    const t = task({ conversationId: 'c1' });
    expect(taskOfTab([t], tabOf({ resumeSessionId: 'c1' }), undefined)).toBe(t);
  });
  it('taskOfTab_ninguna_undefined', () => {
    expect(taskOfTab([task({ sessionId: 'x', conversationId: 'y' })], tabOf(), 's1')).toBeUndefined();
  });
});

describe('isTaskRow', () => {
  const index = buildTaskIndex([task({ sessionId: 's1', conversationId: 'c1' })]);
  it('isTaskRow_historialDeTarea_true', () => {
    const row = { kind: 'history', item: { sessionId: 'c1' }, accountId: '/a' } as unknown as SidebarRow;
    expect(isTaskRow(row, index, {})).toBe(true);
  });
  it('isTaskRow_pestanaNormal_false', () => {
    const row = { kind: 'tab', tab: tabOf(), accountId: '/a' } as SidebarRow;
    expect(isTaskRow(row, index, { tab1: 'otra' })).toBe(false);
  });
});

describe('planOf y declaredDeliverablesOf', () => {
  it('planOf_dosBloques_elUltimoConPlan', () => {
    const blocks = [agent('1', fence('mage-plan', '- [ ] a')), agent('2', 'hola'), agent('3', fence('mage-plan', '- [x] b'))];
    expect(planOf(blocks)).toEqual([{ text: 'b', done: true }]);
  });
  it('planOf_sinPlan_null', () => {
    expect(planOf([agent('1', 'nada')])).toBeNull();
  });
  it('declaredDeliverablesOf_manifiestoRoto_buscaElAnteriorValido', () => {
    const blocks = [agent('1', fence('mage-deliverables', '["a.txt"]')), agent('2', fence('mage-deliverables', '[roto'))];
    expect(declaredDeliverablesOf(blocks)).toEqual(['a.txt']);
  });
});

describe('taskPhase', () => {
  it('taskPhase_permisoPendiente_waiting', () => {
    expect(taskPhase({ status: 'idle', pendingCount: 1, task: task() })).toBe('waiting');
  });
  it('taskPhase_streaming_working', () => {
    expect(taskPhase({ status: 'streaming', pendingCount: 0, task: task({ verdict: 'verified' }) })).toBe('working');
  });
  it('taskPhase_verificada_verified', () => {
    expect(taskPhase({ status: 'idle', pendingCount: 0, task: task({ verdict: 'verified' }) })).toBe('verified');
  });
  it('taskPhase_incompleta_needsReview', () => {
    expect(taskPhase({ status: undefined, pendingCount: 0, task: task({ verdict: 'incomplete' }) })).toBe('needsReview');
  });
  it('taskPhase_sinComprobar_unverified', () => {
    expect(taskPhase({ status: 'idle', pendingCount: 0, task: task() })).toBe('unverified');
  });
});

describe('taskTitle', () => {
  it('taskTitle_largo_cortaConPuntos', () => {
    const title = taskTitle('x'.repeat(100));
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });
  it('taskTitle_lineasVaciasDelante_primeraConTexto', () => {
    expect(taskTitle('\n  \n  Haz esto  \nluego')).toBe('Haz esto');
  });
});

describe('shouldVerify', () => {
  const checked = task({ deliverables: [{ declared: 'a.txt', path: '/f/a.txt', status: 'ok', bytes: 1, modifiedAtMs: 1, kind: 'txt' }] });
  it('shouldVerify_finDeTurnoConManifiestoNuevo_true', () => {
    expect(shouldVerify('streaming', 'idle', ['a.txt', 'b.txt'], checked)).toBe(true);
  });
  it('shouldVerify_mismoManifiesto_false', () => {
    expect(shouldVerify('streaming', 'idle', ['a.txt'], checked)).toBe(false);
  });
  it('shouldVerify_sinManifiesto_false', () => {
    expect(shouldVerify('streaming', 'idle', null, checked)).toBe(false);
  });
  it('shouldVerify_seguiaIdle_false', () => {
    expect(shouldVerify('idle', 'idle', ['z'], checked)).toBe(false);
  });
});

describe('canStartTask', () => {
  it('canStartTask_sinCarpeta_false', () => {
    expect(canStartTask({ goal: 'x', accountDir: '/a', folders: [] })).toBe(false);
  });
  it('canStartTask_objetivoEspacios_false', () => {
    expect(canStartTask({ goal: '   ', accountDir: '/a', folders: ['/f'] })).toBe(false);
  });
  it('canStartTask_completo_true', () => {
    expect(canStartTask({ goal: 'x', accountDir: '/a', folders: ['/f'] })).toBe(true);
  });
});
