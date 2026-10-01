import { describe, expect, it, vi } from 'vitest';
import type { ManagedSession } from './sessionManager';
import type { ProviderAdapter } from './providerAdapter';
import { createSessionFor, type SessionBase, type SessionFactoryDeps } from './sessionFactory';

const BASE = { params: { sessionId: 's', accountDir: '/a', model: 'm', cwd: '/p' }, emit: () => undefined } as SessionBase;
const RUNTIME = { kind: 'runtime' } as unknown as ManagedSession;
const AGENT = { kind: 'agent' } as unknown as ManagedSession;

function deps() {
  const buildAdapter = vi.fn((_provider: string) => ({}) as ProviderAdapter);
  const buildRuntime = vi.fn(() => RUNTIME);
  const factory: SessionFactoryDeps = { buildAdapter, buildRuntime, createAgentSession: () => AGENT };
  return { factory, buildAdapter, buildRuntime };
}

describe('createSessionFor', () => {
  it('create_cliProviders_neverUseRuntime', () => {
    const { factory, buildRuntime, buildAdapter } = deps();

    const sessions = ['claude', 'agy', 'codex'].map((provider) => createSessionFor(provider, BASE, factory));

    expect(sessions).toEqual([AGENT, AGENT, AGENT]);
    expect(buildRuntime).not.toHaveBeenCalled();
    expect(buildAdapter.mock.calls.map(([provider]) => provider)).toEqual(['claude', 'agy', 'codex']);
  });

  it('create_custom_usesRuntime', () => {
    const { factory } = deps();

    expect(createSessionFor('custom:ollama', BASE, factory)).toBe(RUNTIME);
  });

  it('create_retiredCloudBuiltIns_throwWithoutFallingIntoTheRuntime', () => {
    // El gateway se retiro (P-032 R6): `openai`/`gemini` ya no tienen runtime, y nunca caen al propio.
    const { factory, buildRuntime } = deps();

    expect(() => createSessionFor('openai', BASE, factory)).toThrow(/openai/);
    expect(buildRuntime).not.toHaveBeenCalled();
  });

  it('create_unknownProvider_throwsWithProvider', () => {
    const { factory } = deps();

    expect(() => createSessionFor('desconocido', BASE, factory)).toThrow(/desconocido/);
  });
});
