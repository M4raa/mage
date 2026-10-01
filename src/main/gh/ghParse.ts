import { z } from 'zod';
import {
  EMPTY_CHECK_SUMMARY,
  type GhCheck,
  type GhCheckState,
  type GhCheckSummary,
  type GhMergeable,
  type GhPrState,
  type GhPullRequest,
  type GhReviewDecision,
  type GhRun,
} from '@shared/gh';

// Parseo PURO del JSON de `gh` (medido con gh 2.102.0, fixtures en `__fixtures__/`). Tolerante con lo que
// no entiende (un campo nuevo o un valor de enum desconocido no tumba la barra), estricto con lo que
// identifica (sin `number` o `url` no hay PR).

// Campos que se piden a `gh pr list/view --json`. NUNCA `commits` ni `author`: traen correos.
export const PR_FIELDS =
  'number,title,state,isDraft,url,headRefName,headRefOid,baseRefName,headRepositoryOwner,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,autoMergeRequest';
export const RUN_FIELDS = 'databaseId,name,workflowName,status,conclusion,url,attempt,event';

// Un check sin terminar trae `completedAt: "0001-01-01T00:00:00Z"`, la fecha cero de Go (medido).
const GO_ZERO_YEAR = '0001-';

const text = z.string().catch('');

// CheckRun (Actions y apps) o StatusContext (los statuses clasicos: `state`/`context`/`targetUrl`, sin
// medir pero documentados). Los dos en el mismo objeto laxo.
const ROLLUP_ITEM = z.object({
  __typename: text,
  name: text,
  context: text,
  workflowName: text,
  status: text,
  conclusion: text,
  state: text,
  detailsUrl: text,
  targetUrl: text,
  startedAt: text,
  completedAt: text,
});

const PR_SCHEMA = z.object({
  number: z.number().int().positive(),
  title: text,
  url: z.string().url(),
  state: text,
  isDraft: z.boolean().catch(false),
  headRefName: text,
  headRefOid: text,
  baseRefName: text,
  headRepositoryOwner: z.object({ login: text }).nullable().catch(null),
  mergeable: text,
  mergeStateStatus: text,
  reviewDecision: z.string().nullable().catch(null),
  statusCheckRollup: z.array(ROLLUP_ITEM).nullable().catch([]),
  autoMergeRequest: z.unknown().optional(),
});

const RUN_SCHEMA = z.object({
  databaseId: z.number().int().positive(),
  name: text,
  workflowName: text,
  status: text,
  conclusion: text,
  url: text,
  attempt: z.number().int().positive().catch(1),
  event: text,
});

export type GhExitClass = 'ok' | 'no-auth' | 'error';

// Medido: solo la falta de sesion tiene codigo propio (4). Todo lo demas (sin red, sin repo, remoto que
// no es de GitHub, sin PR con `pr view`) sale con 1, y distinguirlo exigiria leer stderr.
const GH_EXIT_NO_AUTH = 4;
export function classifyGhExit(code: number): GhExitClass {
  if (code === 0) return 'ok';
  return code === GH_EXIT_NO_AUTH ? 'no-auth' : 'error';
}

// Normaliza los tres vocabularios. `status` vacio = StatusContext (su `state` llega como conclusion).
export function normalizeCheckState(status: string, conclusion: string): GhCheckState {
  const s = status.toUpperCase();
  const c = conclusion.toUpperCase();
  if ((s !== '' && s !== 'COMPLETED') || c === '' || c === 'PENDING' || c === 'EXPECTED') return 'pending';
  if (c === 'SUCCESS') return 'pass';
  if (c === 'SKIPPED' || c === 'NEUTRAL') return 'skip';
  if (c === 'CANCELLED') return 'cancel';
  return 'fail'; // FAILURE, ERROR, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE, STALE…
}

export function summarizeChecks(checks: readonly GhCheck[]): GhCheckSummary {
  const summary = { ...EMPTY_CHECK_SUMMARY };
  for (const check of checks) summary[check.state] += 1;
  return summary;
}

// Fecha ISO valida o null (la fecha cero de Go y cualquier cosa que no se pueda leer).
function isoOrNull(value: string): string | null {
  if (value.length === 0 || value.startsWith(GO_ZERO_YEAR) || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function toCheck(item: z.infer<typeof ROLLUP_ITEM>): GhCheck {
  const isStatusContext = item.__typename === 'StatusContext';
  const url = isStatusContext ? item.targetUrl : item.detailsUrl;
  return {
    name: isStatusContext ? item.context : item.name,
    workflow: item.workflowName,
    state: isStatusContext ? normalizeCheckState('', item.state) : normalizeCheckState(item.status, item.conclusion),
    url: url.startsWith('https://') ? url : null,
    startedAt: isoOrNull(item.startedAt),
    completedAt: isoOrNull(item.completedAt),
  };
}

function toPrState(state: string): GhPrState {
  const upper = state.toUpperCase();
  if (upper === 'MERGED') return 'merged';
  return upper === 'CLOSED' ? 'closed' : 'open';
}

function toMergeable(value: string): GhMergeable {
  const upper = value.toUpperCase();
  if (upper === 'MERGEABLE') return 'mergeable';
  return upper === 'CONFLICTING' ? 'conflicting' : 'unknown';
}

// Medido: sin revision obligatoria llega `""`, no null.
function toReviewDecision(value: string | null): GhReviewDecision {
  const lower = (value ?? '').toLowerCase();
  return lower === 'approved' || lower === 'changes_requested' || lower === 'review_required' ? lower : null;
}

function toPullRequest(raw: z.infer<typeof PR_SCHEMA>): GhPullRequest {
  const checks = (raw.statusCheckRollup ?? []).map(toCheck);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: toPrState(raw.state),
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    headSha: raw.headRefOid,
    baseRefName: raw.baseRefName,
    mergeable: toMergeable(raw.mergeable),
    mergeStateStatus: raw.mergeStateStatus.toUpperCase(),
    reviewDecision: toReviewDecision(raw.reviewDecision),
    autoMerge: raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined,
    checks,
    summary: summarizeChecks(checks),
  };
}

function parseJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`JSON no valido de ${what}: ${String(err)} (${stdout.slice(0, 80)})`);
  }
}

// `gh pr view <n> --json PR_FIELDS`.
export function parsePrView(stdout: string): GhPullRequest {
  const result = PR_SCHEMA.safeParse(parseJson(stdout, 'gh pr view'));
  if (!result.success) throw new Error(`PR de gh con forma inesperada: ${result.error.message}`);
  return toPullRequest(result.data);
}

// `gh pr list --head <rama> --json PR_FIELDS`: la rama sin PR da `[]` (salida 0, medido). `--head` no
// distingue forks, asi que solo vale un PR cuya rama sea del dueño del remoto. El primero gana (el mas
// reciente). Una entrada con forma rota se salta: que un PR raro no esconda al bueno.
export function pickBranchPr(stdout: string, owner: string): GhPullRequest | null {
  const list = z.array(z.unknown()).safeParse(parseJson(stdout, 'gh pr list'));
  if (!list.success) throw new Error(`Lista de PR de gh con forma inesperada: ${stdout.slice(0, 80)}`);
  for (const entry of list.data) {
    const pr = PR_SCHEMA.safeParse(entry);
    if (!pr.success) continue;
    const login = pr.data.headRepositoryOwner?.login ?? '';
    if (login.toLowerCase() === owner.toLowerCase()) return toPullRequest(pr.data);
  }
  return null;
}

// `gh run list --json RUN_FIELDS`. Mismo criterio: una entrada rota se salta.
export function parseRunList(stdout: string): readonly GhRun[] {
  const list = z.array(z.unknown()).safeParse(parseJson(stdout, 'gh run list'));
  if (!list.success) throw new Error(`Lista de runs de gh con forma inesperada: ${stdout.slice(0, 80)}`);
  const runs: GhRun[] = [];
  for (const entry of list.data) {
    const run = RUN_SCHEMA.safeParse(entry);
    if (!run.success) continue;
    const { databaseId, name, workflowName, status, conclusion, url, attempt, event } = run.data;
    runs.push({ id: databaseId, name: name.length > 0 ? name : workflowName, state: normalizeCheckState(status, conclusion), url, attempt, event });
  }
  return runs;
}
