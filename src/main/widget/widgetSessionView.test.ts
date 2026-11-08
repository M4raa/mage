import { describe, expect, it } from 'vitest';
import type { ConversationSnapshot, PendingRequest } from '@shared/coordination';
import type { PermissionRequest } from '@shared/events';
import { toWidgetRequest, toWidgetSessionView } from './widgetSessionView';

function permission(overrides: Partial<PermissionRequest> = {}): PendingRequest {
  return {
    kind: 'permission',
    request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: { command: 'ls' }, description: null, requiresUserInteraction: false, displayName: null, ...overrides },
  };
}

const COLOR_QUESTION = { question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: '' }, { label: 'Azul', description: '' }], multiSelect: false };

function ask(questions: readonly unknown[]): PendingRequest {
  return permission({ toolName: 'AskUserQuestion', input: { questions }, requiresUserInteraction: true });
}

describe('toWidgetRequest', () => {
  it('toWidgetRequest_bashPermission_usesCommandAsDetail', () => {
    expect(toWidgetRequest(permission())).toEqual({ kind: 'permission', requestId: 'r1', tool: 'Bash', detail: 'ls' });
  });
  it('toWidgetRequest_description_winsOverInput', () => {
    const view = toWidgetRequest(permission({ description: 'Ejecutar ls' }));
    expect(view).toMatchObject({ kind: 'permission', detail: 'Ejecutar ls' });
  });
  it('toWidgetRequest_displayName_winsOverToolName', () => {
    expect(toWidgetRequest(permission({ displayName: 'Leer fichero' }))).toMatchObject({ tool: 'Leer fichero' });
  });
  it('toWidgetRequest_noDetailFields_detailNull', () => {
    expect(toWidgetRequest(permission({ input: {} }))).toMatchObject({ kind: 'permission', detail: null });
  });
  it('toWidgetRequest_longCommand_truncatesTo160', () => {
    const view = toWidgetRequest(permission({ input: { command: 'a'.repeat(300) } }));
    const detail = view.kind === 'permission' ? view.detail : null;
    expect(detail).toHaveLength(160);
    expect(detail?.endsWith('…')).toBe(true);
  });
  it('toWidgetRequest_singleChoiceQuestion_returnsQuestion', () => {
    expect(toWidgetRequest(ask([COLOR_QUESTION]))).toEqual({ kind: 'question', requestId: 'r1', question: '¿Rojo o azul?', options: ['Rojo', 'Azul'] });
  });
  it('toWidgetRequest_multiSelectQuestion_returnsInApp', () => {
    expect(toWidgetRequest(ask([{ ...COLOR_QUESTION, multiSelect: true }]))).toEqual({ kind: 'in_app', requestId: 'r1', tool: 'AskUserQuestion' });
  });
  it('toWidgetRequest_twoQuestions_returnsInApp', () => {
    expect(toWidgetRequest(ask([COLOR_QUESTION, COLOR_QUESTION])).kind).toBe('in_app');
  });
  it('toWidgetRequest_requiresInteractionWithoutQuestions_returnsInApp', () => {
    expect(toWidgetRequest(permission({ input: {}, requiresUserInteraction: true })).kind).toBe('in_app');
  });
  it('toWidgetRequest_elicitation_returnsInAppWithServer', () => {
    const pending: PendingRequest = { kind: 'elicitation', request: { requestId: 'e1', server: 'github', message: 'Login', mode: 'url', url: 'https://x', elicitationId: 'x' } };
    expect(toWidgetRequest(pending)).toEqual({ kind: 'in_app', requestId: 'e1', tool: 'github' });
  });
});

describe('toWidgetSessionView', () => {
  it('toWidgetSessionView_copiesFactsAndOmitsQueue', () => {
    const snapshot = {
      sessionId: 's1', provider: 'claude', conversationId: null, nativeRef: { provider: 'claude', id: 'n1' }, lastSeq: 3, state: 'running',
      queue: [{ id: 'm1', text: 'hola' }], pending: [permission()], background: false,
    } as unknown as ConversationSnapshot;
    const view = toWidgetSessionView(snapshot, 'none');
    expect(Object.keys(view).sort()).toEqual(['background', 'outcome', 'provider', 'requests', 'sessionId', 'state']);
    expect(view.requests).toHaveLength(1);
  });
});
