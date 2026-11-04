import type { GhOffReason, GhPullRequest } from './gh';

// Panel de PR (F5.5): una PR se identifica por `PrKey` (host, dueño, repo y numero), no por el numero
// suelto que guardan las pestañas: dos repos distintos pueden tener cada uno su #7. Cruza el IPC.

export interface PrKey {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

const HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const NAME_PATTERN = /^[a-z0-9_.-]+$/;
const NUMBER_PATTERN = /^[1-9][0-9]*$/;
const DOT_SEGMENTS: ReadonlySet<string> = new Set(['.', '..']);
const KEY_SEGMENTS = 3;

// `host/owner/repo#number` en minusculas (GitHub no distingue mayusculas en los nombres): dos escrituras
// de la misma PR son la misma entrada.
export function prKeyToString(key: PrKey): string {
  return `${key.host}/${key.owner}/${key.repo}#${key.number}`.toLowerCase();
}

function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name) && !DOT_SEGMENTS.has(name);
}

// null ante cualquier cosa que no sea una clave bien formada (incluidos `.`/`..` como dueño o repo).
export function parsePrKey(text: string): PrKey | null {
  const hash = text.toLowerCase().split('#');
  if (hash.length !== 2 || !NUMBER_PATTERN.test(hash[1]!)) return null;
  const number = Number(hash[1]);
  const parts = hash[0]!.split('/');
  if (!Number.isSafeInteger(number) || parts.length !== KEY_SEGMENTS) return null;
  const [host, owner, repo] = parts as [string, string, string];
  if (!HOST_PATTERN.test(host) || !isValidName(owner) || !isValidName(repo)) return null;
  return { host, owner, repo, number };
}

export function samePrKey(a: PrKey, b: PrKey): boolean {
  return prKeyToString(a) === prKeyToString(b);
}

export type PrListState = 'open' | 'draft' | 'closed' | 'merged' | 'all';
export type MergeStrategy = 'merge' | 'squash' | 'rebase';

export interface PrSnapshot extends GhPullRequest {
  readonly key: PrKey;
  readonly updatedAt: string; // ISO-8601 UTC o '' si gh no mando una fecha valida
  readonly author: string;
}

export interface PrDetail extends PrSnapshot {
  readonly body: string;
  readonly reviews: readonly { readonly author: string; readonly state: string; readonly submittedAt: string; readonly body: string }[];
  readonly comments: readonly { readonly author: string; readonly createdAt: string; readonly body: string }[];
  readonly files: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
}

export interface RepoMergeOptions {
  readonly merge: boolean;
  readonly squash: boolean;
  readonly rebase: boolean;
}

export type PrWriteAction =
  | { readonly kind: 'comment'; readonly body: string }
  | { readonly kind: 'review'; readonly event: 'approve' | 'request_changes' | 'comment'; readonly body: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'reopen' }
  | { readonly kind: 'merge'; readonly strategy: MergeStrategy; readonly deleteBranch: boolean }
  | { readonly kind: 'autoMerge'; readonly enabled: boolean; readonly strategy: MergeStrategy };

export interface PrWriteParams {
  readonly cwd: string;
  readonly accountDir: string;
  readonly key: PrKey;
  readonly expectedHeadSha: string;
  readonly action: PrWriteAction;
}

export type PrWriteResult = { readonly kind: 'ok' } | { readonly kind: 'conflict'; readonly currentHeadSha: string };

export interface PrListParams {
  readonly cwd: string;
  readonly accountDir: string;
  readonly repo: { readonly host: string; readonly owner: string; readonly repo: string };
  readonly state: PrListState;
  readonly limit: number;
}

export type PrListResult =
  | { readonly kind: 'off'; readonly reason: GhOffReason }
  | { readonly kind: 'list'; readonly prs: readonly PrSnapshot[]; readonly mergeOptions: RepoMergeOptions };

// Catalogo de PR (userData/pr-catalog.json): que conversaciones tienen vinculada cada PR. El vinculo con
// PROYECTO se deriva de las conversaciones del proyecto: no se guarda aparte.
export interface PrCatalogEntry {
  readonly key: string; // `prKeyToString`
  readonly links: readonly { readonly conversationId: string; readonly primary: boolean }[];
}

export interface PrCatalogLinkParams {
  readonly key: string;
  readonly conversationId: string;
  readonly primary: boolean;
}

export interface PrMigrateParams {
  readonly cwd: string;
  readonly accountDir: string;
  readonly conversationId: string;
  readonly number: number;
}
