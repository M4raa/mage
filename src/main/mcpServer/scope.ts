import { scopeDenied } from './errors';
import type { CreationTarget, SessionMetadata } from './sessionsPort';

export interface ConnectionScope {
  readonly projectIds: readonly string[];
  readonly accountIds: readonly string[];
  readonly conversationIds?: readonly string[];
  readonly includePrivate?: boolean;
  readonly caller?: { readonly conversationId: string; readonly creatorChain: readonly string[] };
}
export interface ScopeSnapshot {
  readonly projectIds: ReadonlySet<string>;
  readonly accountIds: ReadonlySet<string>;
  readonly conversationIds?: ReadonlySet<string>;
  readonly includePrivate: boolean;
  readonly caller?: { readonly conversationId: string; readonly creatorChain: readonly string[] };
}
export function snapshotScope(scope: ConnectionScope): ScopeSnapshot {
  return {
    projectIds: new Set(scope.projectIds), accountIds: new Set(scope.accountIds),
    ...(scope.conversationIds === undefined ? {} : { conversationIds: new Set(scope.conversationIds) }),
    includePrivate: scope.includePrivate ?? false,
    ...(scope.caller === undefined ? {} : { caller: { conversationId: scope.caller.conversationId, creatorChain: [...scope.caller.creatorChain] } }),
  };
}
export function isSessionAllowed(scope: ScopeSnapshot, session: SessionMetadata): boolean {
  return scope.projectIds.has(session.projectId) && scope.accountIds.has(session.accountId)
    && (scope.conversationIds === undefined || scope.conversationIds.has(session.conversationId))
    && (!session.isPrivate || scope.includePrivate);
}
export function authorizeProject(scope: ScopeSnapshot, projectId?: string): void {
  if (projectId !== undefined && !scope.projectIds.has(projectId)) scopeDenied();
}
export function authorizeTarget(scope: ScopeSnapshot, target: CreationTarget, provider: string): void {
  if (!scope.projectIds.has(target.projectId) || !scope.accountIds.has(target.accountId) || target.provider !== provider) scopeDenied();
}
export function scopeIdentity(scope: ScopeSnapshot): unknown {
  return {
    projectIds: [...scope.projectIds].sort(), accountIds: [...scope.accountIds].sort(),
    conversationIds: scope.conversationIds === undefined ? null : [...scope.conversationIds].sort(),
    includePrivate: scope.includePrivate, caller: scope.caller ?? null,
  };
}
