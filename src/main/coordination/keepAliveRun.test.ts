import { describe, expect, it } from 'vitest';
import type { MageEvent, TurnUsage } from '@shared/events';
import { foreignText } from '@shared/i18n/localizedText';
import { keepAliveStep, type KeepAliveRun } from './keepAliveRun';

const RUN: KeepAliveRun = { uuid: '11111111-1111-4111-8111-111111111111', interrupted: false };
const USAGE: TurnUsage = { inputTokens: 1, outputTokens: 2, totalTokens: 3, thinkingTokens: null, cacheReadTokens: 10, cacheCreationTokens: 0 };

const TOOL_USE: MageEvent = { kind: 'tool_use', tool: { toolUseId: 't1', toolName: 'Bash', input: {} } };

describe('keepAliveStep', () => {
  it('keepAliveStep_permissionRequest_denies', () => {
    const event: MageEvent = {
      kind: 'permission_request',
      request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: {}, description: null, requiresUserInteraction: false, displayName: null },
    };

    expect(keepAliveStep(RUN, event)).toEqual({ step: { kind: 'deny_permission', requestId: 'r1' }, run: RUN });
  });

  it('keepAliveStep_firstToolUse_interruptsAndMarksRun', () => {
    expect(keepAliveStep(RUN, TOOL_USE)).toEqual({ step: { kind: 'interrupt' }, run: { ...RUN, interrupted: true } });
  });

  it('keepAliveStep_secondToolUse_ignored', () => {
    const interrupted = { ...RUN, interrupted: true };

    expect(keepAliveStep(interrupted, TOOL_USE)).toEqual({ step: { kind: 'ignore' }, run: interrupted });
  });

  it('keepAliveStep_result_finishesWithUsageAndCost', () => {
    const event: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1, usage: USAGE, costMicroUsd: 42 } };

    expect(keepAliveStep(RUN, event).step).toEqual({ kind: 'finish', usage: USAGE, costMicroUsd: 42 });
  });

  it('keepAliveStep_resultWithoutUsage_finishesWithNulls', () => {
    const event: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };

    expect(keepAliveStep(RUN, event).step).toEqual({ kind: 'finish', usage: null, costMicroUsd: null });
  });

  it('keepAliveStep_sessionRestarting_aborts', () => {
    expect(keepAliveStep(RUN, { kind: 'session_restarting', attempt: 1, delayMs: 100 }).step).toEqual({ kind: 'abort' });
  });

  it('keepAliveStep_error_aborts', () => {
    expect(keepAliveStep(RUN, { kind: 'error', localized: foreignText('boom') }).step).toEqual({ kind: 'abort' });
  });

  it('keepAliveStep_otherEvent_ignored', () => {
    expect(keepAliveStep(RUN, { kind: 'request_started' })).toEqual({ step: { kind: 'ignore' }, run: RUN });
  });
});
