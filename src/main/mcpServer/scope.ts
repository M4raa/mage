import { scopeDenied } from './errors';
import type { CreationTarget, SessionMetadata } from './sessionsPort';

export interface ConnectionScope {
  // D-M7: el alcance de una sesión de Mage es por delegación, no por proyecto; el puerto lo aplica.
  readonly projectIds?: readonly string[];
  readonly accountIds: readonly string[];
  readonly conversationIds?: readonly string[];
  readonly includePrivate?: boolean;
  readonly caller?: { readonly conversationId: string; readonly creatorChain: readonly string[] };
}
export interface ScopeSnapshot {
  // null = cualquier proyecto (D-M7: el alcance es por delegación; el puerto lo aplica).
  readonly projectIds: ReadonlySet<string> | null;
  readonly accountIds: ReadonlySet<string>;
  readonly conversationIds?: ReadonlySet<string>;
  readonly includePrivate: boolean;
  readonly caller?: { readonly conversationId: string; readonly creatorChain: readonly string[] };
}
export function snapshotScope(scope: ConnectionScope): ScopeSnapshot {
  return {
    projectIds: scope.projectIds === undefined ? null : new Set(scope.projectIds), accountIds: new Set(scope.accountIds),
    ...(scope.conversationIds === undefined ? {} : { conversationIds: new Set(scope.conversationIds) }),
    includePrivate: scope.includePrivate ?? false,
    ...(scope.caller === undefined ? {} : { caller: { conversationId: scope.caller.conversationId, creatorChain: [...scope.caller.creatorChain] } }),
  };
}
export function isSessionAllowed(scope: ScopeSnapshot, session: SessionMetadata): boolean {
  return isProjectAllowed(scope, session.projectId) && scope.accountIds.has(session.accountId)
    && (scope.conversationIds === undefined || scope.conversationIds.has(session.conversationId))
    && (!session.isPrivate || scope.includePrivate);
}
function isProjectAllowed(scope: ScopeSnapshot, projectId: string): boolean {
  return scope.projectIds === null || scope.projectIds.has(projectId);
}
export function authorizeProject(scope: ScopeSnapshot, projectId?: string): void {
  if (projectId !== undefined && !isProjectAllowed(scope, projectId)) scopeDenied();
}
export function authorizeTarget(scope: ScopeSnapshot, target: CreationTarget, provider: string): void {
  if (!isProjectAllowed(scope, target.projectId) || !scope.accountIds.has(target.accountId) || target.provider !== provider) scopeDenied();
}
export function scopeIdentity(scope: ScopeSnapshot): unknown {
  return {
    projectIds: scope.projectIds === null ? null : [...scope.projectIds].sort(), accountIds: [...scope.accountIds].sort(),
    conversationIds: scope.conversationIds === undefined ? null : [...scope.conversationIds].sort(),
    includePrivate: scope.includePrivate, caller: scope.caller ?? null,
  };
}
