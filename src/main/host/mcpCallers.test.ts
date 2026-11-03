import { describe, expect, it } from 'vitest';
import { McpCallers } from './mcpCallers';

function build(live: (id: string) => boolean = () => true): McpCallers {
  let n = 0;
  return new McpCallers({ randomBytes: (size) => Buffer.alloc(size, ++n), isLive: live });
}

describe('McpCallers', () => {
  it('mint_newSession_returns64HexChars', () => {
    expect(build().mint('s1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mint_sameSessionTwice_sameCredential', () => {
    const callers = build();
    expect(callers.mint('s1')).toBe(callers.mint('s1'));
  });

  it('mint_twoSessions_differentCredentials', () => {
    const callers = build();
    expect(callers.mint('s1')).not.toBe(callers.mint('s2'));
  });

  it('mint_emptySessionId_throws', () => {
    expect(() => build().mint('')).toThrow('""');
  });

  it('resolve_known_returnsSessionId', () => {
    const callers = build();
    expect(callers.resolve(callers.mint('s1'))).toBe('s1');
  });

  it('resolve_unknownOrEmptyOrUndefined_null', () => {
    const callers = build();
    expect(callers.resolve('f'.repeat(64))).toBeNull();
    expect(callers.resolve('')).toBeNull();
    expect(callers.resolve(undefined)).toBeNull();
  });

  it('resolve_deadSession_nullAndForgotten', () => {
    let alive = true;
    const callers = build(() => alive);
    const credential = callers.mint('s1');
    alive = false;
    expect(callers.resolve(credential)).toBeNull();
    alive = true;
    expect(callers.resolve(credential)).toBeNull();
    expect(callers.mint('s1')).not.toBe(credential);
  });
});
