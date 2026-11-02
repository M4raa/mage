import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n/translator';
import { renderLocalized } from './i18n/localizedText';
import { formatToolAccessRules, isToolAllowed, parseToolAccessText } from './toolAccess';

describe('parseToolAccessText', () => {
  it('parse_rules_allowAndDeny', () => {
    const { rules, errors } = parseToolAccessText('*: -Bash\nqwen: Read, Glob\n\n# nota\nllama: -mcp__github__*');

    expect(errors).toEqual([]);
    expect(rules).toEqual([
      { model: '*', allow: null, deny: ['Bash'] },
      { model: 'qwen', allow: ['Read', 'Glob'], deny: [] },
      { model: 'llama', allow: null, deny: ['mcp__github__*'] },
    ]);
  });

  it('parse_badLines_reportedWithNumber', () => {
    const { errors } = parseToolAccessText('sin dos puntos\nqwen:   ');

    expect(errors).toEqual([
      { key: 'settings.providers.toolAccessMissingModel', values: { line: '1', text: 'sin dos puntos' } },
      { key: 'settings.providers.toolAccessNoTools', values: { line: '2', text: 'qwen:' } },
    ]);
    expect(errors.map((error) => renderLocalized(createTranslator('es'), error))).toEqual([
      'Línea 1: falta «modelo:» delante (sin dos puntos)',
      'Línea 2: no nombra ninguna herramienta (qwen:)',
    ]);
  });

  it('format_roundTrip', () => {
    const text = '*: -Bash\nqwen: Read, -Write';

    expect(formatToolAccessRules(parseToolAccessText(text).rules)).toBe(text);
  });
});

describe('isToolAllowed', () => {
  const { rules } = parseToolAccessText('*: -Bash\nqwen: Read, Glob, mcp__*\nllama: -mcp__github__*');

  it('allowed_noRules_everything', () => {
    expect(isToolAllowed([], 'x', 'Bash')).toBe(true);
  });

  it('allowed_denyForAll_wins', () => {
    expect(['qwen', 'llama', 'otro'].map((model) => isToolAllowed(rules, model, 'Bash'))).toEqual([false, false, false]);
  });

  it('allowed_allowList_onlyThose', () => {
    expect(['Read', 'Write', 'mcp__fs__leer'].map((tool) => isToolAllowed(rules, 'qwen', tool))).toEqual([true, false, true]);
  });

  it('allowed_wildcardDeny_onlyThatServer', () => {
    expect([isToolAllowed(rules, 'llama', 'mcp__github__issues'), isToolAllowed(rules, 'llama', 'mcp__fs__leer')]).toEqual([false, true]);
  });
});
