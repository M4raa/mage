import { describe, expect, it } from 'vitest';
import type { PendingRequest } from '@shared/coordination';
import type { PermissionRequest } from '@shared/events';
import type { WidgetAnswer, WidgetChoice } from '@shared/widget';
import { decideWidgetAnswer } from './widgetAnswer';

function permission(overrides: Partial<PermissionRequest> = {}): PendingRequest {
  return {
    kind: 'permission',
    request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: { command: 'ls' }, description: null, requiresUserInteraction: false, displayName: null, ...overrides },
  };
}

const QUESTION_INPUT = { questions: [{ question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: '' }, { label: 'Azul', description: '' }], multiSelect: false }] };
const question = (): PendingRequest => permission({ toolName: 'AskUserQuestion', input: QUESTION_INPUT, requiresUserInteraction: true });
const answer = (choice: WidgetChoice): WidgetAnswer => ({ sessionId: 's1', requestId: 'r1', choice });

describe('decideWidgetAnswer', () => {
  it('decideWidgetAnswer_unknownRequest_rejected', () => {
    expect(decideWidgetAnswer([], answer({ kind: 'allow' }))).toEqual({ kind: 'rejected' });
  });
  it('decideWidgetAnswer_allowPermission_allowWithoutInput', () => {
    expect(decideWidgetAnswer([permission()], answer({ kind: 'allow' }))).toEqual({ kind: 'decision', decision: { behavior: 'allow' } });
  });
  it('decideWidgetAnswer_denyPermission_denyWithMessage', () => {
    expect(decideWidgetAnswer([permission()], answer({ kind: 'deny' }))).toEqual({ kind: 'decision', decision: { behavior: 'deny', message: 'Denegado por el usuario' } });
  });
  it('decideWidgetAnswer_option_buildsAnswers', () => {
    const result = decideWidgetAnswer([question()], answer({ kind: 'option', label: 'Azul' }));
    expect(result).toEqual({ kind: 'decision', decision: { behavior: 'allow', updatedInput: { ...QUESTION_INPUT, answers: { '¿Rojo o azul?': 'Azul' } } } });
  });
  it('decideWidgetAnswer_unknownOption_throws', () => {
    expect(() => decideWidgetAnswer([question()], answer({ kind: 'option', label: 'Verde' }))).toThrow('Verde');
  });
  it('decideWidgetAnswer_allowOnQuestion_throws', () => {
    expect(() => decideWidgetAnswer([question()], answer({ kind: 'allow' }))).toThrow();
  });
  it('decideWidgetAnswer_optionOnPermission_throws', () => {
    expect(() => decideWidgetAnswer([permission()], answer({ kind: 'option', label: 'Azul' }))).toThrow();
  });
  it('decideWidgetAnswer_denyOnQuestion_denies', () => {
    const result = decideWidgetAnswer([question()], answer({ kind: 'deny' }));
    expect(result).toMatchObject({ kind: 'decision', decision: { behavior: 'deny' } });
  });
  it('decideWidgetAnswer_elicitation_throws', () => {
    const pending: PendingRequest = { kind: 'elicitation', request: { requestId: 'r1', server: 'github', message: 'Login', mode: 'url', url: 'https://x', elicitationId: 'x' } };
    expect(() => decideWidgetAnswer([pending], answer({ kind: 'allow' }))).toThrow();
  });
});
