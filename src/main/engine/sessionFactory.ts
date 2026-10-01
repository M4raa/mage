import { AGY_PROVIDER_ID, BUILT_IN_PROVIDERS, CODEX_PROVIDER_ID, CUSTOM_PROVIDER_ID_PREFIX } from '@shared/providers';
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
  // Hasta R3, el runtime solo se usa con el interruptor `MAGE_RUNTIME=1`; sin el, los `custom:*`
  // siguen por el gateway. Temporal: R3 lo borra.
  readonly runtimeEnabled: boolean;
  readonly createAgentSession?: (deps: AgentSessionDeps) => ManagedSession;
}

const CLI_PROVIDERS: readonly string[] = ['claude', AGY_PROVIDER_ID, CODEX_PROVIDER_ID];

export function createSessionFor(provider: string, base: SessionBase, deps: SessionFactoryDeps): ManagedSession {
  const createAgent = deps.createAgentSession ?? ((agentDeps: AgentSessionDeps) => new AgentSession(agentDeps));
  if (CLI_PROVIDERS.includes(provider)) return createAgent({ ...base, adapter: deps.buildAdapter(provider) });
  const isCustom = provider.startsWith(CUSTOM_PROVIDER_ID_PREFIX);
  if (isCustom && deps.runtimeEnabled) return deps.buildRuntime(provider, base);
  // Gateway (se retira en R6): los `custom:*` sin interruptor y los de serie de nube.
  if (isCustom || BUILT_IN_PROVIDERS.some((entry) => entry.id === provider)) {
    return createAgent({ ...base, adapter: deps.buildAdapter(provider) });
  }
  throw new Error(`Proveedor sin runtime: ${JSON.stringify(provider)}`);
}
