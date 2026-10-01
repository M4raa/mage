import type { GitParams } from './git';

// PR y CI de la rama de una conversacion, leidos con el GitHub CLI (`gh`). Cruza el IPC: solo datos ya
// normalizados, nunca stderr, tokens ni URLs con credenciales.

// Los tres vocabularios de estado que habla `gh` (el rollup en MAYUSCULAS, el `bucket` de `pr checks` y
// el de `run list` en minusculas) se reducen a este, el de los «buckets» de `gh pr checks`.
export type GhCheckState = 'pending' | 'pass' | 'fail' | 'skip' | 'cancel';

export interface GhCheck {
  readonly name: string;
  readonly workflow: string; // '' en un check que no es de Actions (medido: GitGuardian)
  readonly state: GhCheckState;
  readonly url: string | null;
  readonly startedAt: string | null; // ISO-8601 UTC
  readonly completedAt: string | null; // null sin terminar (gh manda la fecha cero de Go)
}

export type GhCheckSummary = Readonly<Record<GhCheckState, number>>;

export type GhPrState = 'open' | 'merged' | 'closed';
export type GhMergeable = 'mergeable' | 'conflicting' | 'unknown';
export type GhReviewDecision = 'approved' | 'changes_requested' | 'review_required' | null;

export interface GhPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: GhPrState;
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly headSha: string;
  readonly baseRefName: string;
  readonly mergeable: GhMergeable;
  readonly mergeStateStatus: string; // CLEAN, UNSTABLE, BLOCKED… tal cual, en mayusculas
  readonly reviewDecision: GhReviewDecision;
  readonly autoMerge: boolean;
  readonly checks: readonly GhCheck[];
  readonly summary: GhCheckSummary;
}

// Por que no hay PR que enseñar. `no-gh`/`no-auth` son los unicos que la UI explica (DA-3); el resto
// (sin repo, sin confianza, remoto que no es de GitHub, fallo de red) no pinta nada.
export type GhOffReason = 'no-gh' | 'no-auth' | 'no-repo' | 'not-github' | 'error';

export type GhSnapshot =
  | { readonly kind: 'off'; readonly reason: GhOffReason }
  | { readonly kind: 'no-pr'; readonly branch: string }
  | { readonly kind: 'pr'; readonly pr: GhPullRequest };

export interface GhRun {
  readonly id: number; // `databaseId`, el que piden `gh run rerun/cancel`
  readonly name: string;
  readonly state: GhCheckState;
  readonly url: string;
  readonly attempt: number;
  readonly event: string;
}

export type GhRunsSnapshot = { readonly kind: 'off'; readonly reason: GhOffReason } | { readonly kind: 'runs'; readonly runs: readonly GhRun[] };

export interface GhRunsParams extends GitParams {
  readonly branch: string;
}

export interface GhRunActionParams extends GitParams {
  readonly runId: number;
  readonly action: 'rerun' | 'cancel';
}

export interface GhAutoMergeParams extends GitParams {
  readonly number: number;
  readonly enabled: boolean;
}

// Vigilancia de un PR vinculado (sondeo en main, sin depender del foco). `key` es la pestaña.
export interface GhWatchParams extends GitParams {
  readonly key: string;
  readonly number: number;
}

export interface GhPrUpdate {
  readonly key: string;
  readonly snapshot: GhSnapshot;
  // Los checks que estaban en marcha acaban de terminar todos (para el aviso de escritorio).
  readonly ciFinished: boolean;
}

export const EMPTY_CHECK_SUMMARY: GhCheckSummary = { pending: 0, pass: 0, fail: 0, skip: 0, cancel: 0 };
