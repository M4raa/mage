import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chatClient';
import { ContextBudget, ContextOverflowError, RESERVE_TOKENS } from './contextBudget';

const text = (chars: number): string => 'x'.repeat(chars);
const user = (chars: number): ChatMessage => ({ role: 'user', content: text(chars) });

describe('ContextBudget', () => {
  it('fit_justAtLimit_passesUntouched', () => {
    const budget = new ContextBudget(2_048, 'm');
    // limite = 2048 - 1024 = 1024 tokens; cada mensaje suma 4 de cabecera.
    const messages = [user((1_024 - 4) * 4)];

    expect(budget.fit(messages)).toBe(messages);
  });

  it('fit_oneAbove_throwsExplained', () => {
    const budget = new ContextBudget(2_048, 'qwen');

    expect(() => budget.fit([user((1_024 - 4) * 4 + 1)])).toThrow(ContextOverflowError);
    expect(() => budget.fit([user(5_000)])).toThrow(/2048 tokens de qwen/);
  });

  it('fit_oldToolOutputs_trimmedToFit', () => {
    const budget = new ContextBudget(4_096, 'm');
    const tool = (id: string, chars: number): ChatMessage => ({ role: 'tool', tool_call_id: id, content: `linea uno\n${text(chars)}` });
    const messages: ChatMessage[] = [user(10), tool('a', 6_000), tool('b', 6_000), tool('c', 100), tool('d', 100)];

    const fitted = budget.fit(messages);

    expect(fitted.slice(1, 3).every((m) => m.role === 'tool' && m.content.startsWith('[salida recortada'))).toBe(true);
    expect(fitted.slice(3)).toEqual(messages.slice(3)); // las dos ultimas se quedan enteras
  });

  it('constructor_windowZeroOrTiny_throwsWithValue', () => {
    expect(() => new ContextBudget(0, 'm')).toThrow(/0/);
    expect(() => new ContextBudget(RESERVE_TOKENS, 'm')).toThrow(String(RESERVE_TOKENS));
  });

  it('recalibrate_realUsage_scalesEstimates', () => {
    const budget = new ContextBudget(8_192, 'm');
    const messages = [user(400)]; // 100 + 4 = 104 tokens estimados
    budget.fit(messages);

    budget.recalibrate(208);

    expect(budget.estimate(messages)).toBe(208);
  });

  it('recalibrate_absurdUsage_isClamped', () => {
    const budget = new ContextBudget(8_192, 'm');
    budget.fit([user(400)]);

    budget.recalibrate(1_000_000);

    expect(budget.estimate([user(400)])).toBe(104 * 3);
  });

  it('usage_afterTurn_reportsWindowAsMax', () => {
    const usage = new ContextBudget(4_096, 'm').usage([{ role: 'system', content: text(400) }, user(400)]);

    expect(usage).toMatchObject({ totalTokens: 208, maxTokens: 4_096, percentage: 5 });
    expect(usage.categories.map((c) => c.name)).toEqual(['System prompt', 'Messages', 'Free space']);
  });

  it('isNearLimit_above80PercentOfUsableLimit_true', () => {
    const budget = new ContextBudget(2_048, 'm');

    expect([budget.isNearLimit([user(4 * 900)]), budget.isNearLimit([user(40)])]).toEqual([true, false]);
  });
});
