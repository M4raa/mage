import { AGY_PROVIDER_ID, CODEX_PROVIDER_ID, runsOnMageRuntime } from '@shared/providers';
import { AgentSession, type AgentSessionDeps } from './agentSession';
import type { ProviderAdapter } from './providerAdapter';
import type { ManagedSession } from './sessionManager';

// Que runtime ejecuta cada proveedor (P-032 §4.1). Orden de OpenClaw: el PROVEEDOR decide el runtime, y
// un proveedor sin runtime conocido falla aqui en vez de caer en otro.
//   - claude, agy, codex: su CLI real sobre `AgentSession` (invariante «Motor» de CLAUDE.md).
//   - custom:* (endpoints OpenAI-compatibles del usuario): el runtime propio de Mage.
// Un fabricante con CLI NUNCA va por el runtime: es la guarda de que reescribir el motor no abre la
// puerta a facturar su API por otra via.

export type SessionBase = Pick<AgentSessionDeps, 'params' | 'emit' | 'log'>;

export interface SessionFactoryDeps {
  readonly buildAdapter: (provider: string) => ProviderAdapter;
  readonly buildRuntime: (provider: string, base: SessionBase) => ManagedSession;
  readonly createAgentSession?: (deps: AgentSessionDeps) => ManagedSession;
}

const CLI_PROVIDERS: readonly string[] = ['claude', AGY_PROVIDER_ID, CODEX_PROVIDER_ID];

export function createSessionFor(provider: string, base: SessionBase, deps: SessionFactoryDeps): ManagedSession {
  const createAgent = deps.createAgentSession ?? ((agentDeps: AgentSessionDeps) => new AgentSession(agentDeps));
  if (CLI_PROVIDERS.includes(provider)) return createAgent({ ...base, adapter: deps.buildAdapter(provider) });
  if (runsOnMageRuntime(provider)) return deps.buildRuntime(provider, base);
  throw new Error(`Proveedor sin runtime: ${JSON.stringify(provider)}`);
}
