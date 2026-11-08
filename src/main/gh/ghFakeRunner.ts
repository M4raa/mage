import type { GhRunner } from './ghService';

// `gh` FALSO para `verify:gui`, activo solo con MAGE_GH_FAKE=1 (mismo patron que MAGE_MCP_FAKE_CLI: en
// proceso, sin spawnear nada, porque Node no lanza `.cmd` sin shell). Contesta con la FORMA medida en gh
// 2.102.0 y guarda estado para que una accion se vea en la siguiente lectura: relanzar pone el run en
// marcha, cancelar lo cancela y el auto-merge se enciende y se apaga. Nunca habla con GitHub.
//
// Por rama: `main` no tiene PR (para «Crear PR»), `vg-sin-sesion` sale como si gh no tuviera sesion (4) y
// cualquier otra tiene el PR #7 en borrador, con un check roto, otro en marcha y otro que pasa.
//
// Panel de PR (F5.5): con `-R host/owner/repo` hay DOS repos, `acme/demo` y `acme/otro`, cada uno con su PR
// #7 (titulo y head distintos) y su propio estado: comentar, revisar, cerrar, reabrir y fusionar se ven en la
// siguiente lectura. Fusionar con `--match-head-commit` distinto del head sale con 1, como GitHub. Un `--admin`
// NUNCA debe llegar aqui: lanza.

export const FAKE_GH_BIN = 'gh-falso';
export const FAKE_PR_NUMBER = 7;
const NO_PR_BRANCH = 'main';
const NO_AUTH_BRANCH = 'vg-sin-sesion';
const GH_EXIT_NO_AUTH = 4;
const GH_EXIT_FAILED = 1;
const GO_ZERO = '0001-01-01T00:00:00Z';
const DEMO_REPO = 'github.com/acme/demo';
const OTHER_REPO = 'github.com/acme/otro';
const FAKE_AUTHOR = { login: 'vg-bot' };
const FAKE_DATE = '2026-10-01T10:00:00Z';
const FAKE_PATCH = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n hola\n+VG: linea nueva\n';

interface FakeRun {
  readonly id: number;
  readonly name: string;
  status: string;
  conclusion: string;
}

interface FakeComment {
  readonly author: { readonly login: string };
  readonly body: string;
  readonly createdAt: string;
}

interface FakeRepo {
  readonly title: string;
  readonly head: string;
  readonly isDraft: boolean;
  readonly rebaseAllowed: boolean;
  readonly withChecks: boolean;
  state: string;
  reviewDecision: string;
  autoMerge: boolean;
  comments: FakeComment[];
  reviews: { author: { login: string }; state: string; submittedAt: string; body: string }[];
}

const initialRuns = (): FakeRun[] => [
  { id: 101, name: 'check', status: 'completed', conclusion: 'failure' },
  { id: 102, name: 'lint', status: 'in_progress', conclusion: '' },
];

const initialRepos = (): Record<string, FakeRepo> => ({
  [DEMO_REPO]: { title: 'VG: PR falso de verify:gui', head: '0123456789abcdef0123456789abcdef01234567', isDraft: true, rebaseAllowed: true, withChecks: true, state: 'OPEN', reviewDecision: '', autoMerge: false, comments: [], reviews: [] },
  [OTHER_REPO]: { title: 'VG: otra PR #7', head: 'fedcba9876543210fedcba9876543210fedcba98', isDraft: false, rebaseAllowed: false, withChecks: false, state: 'OPEN', reviewDecision: '', autoMerge: false, comments: [], reviews: [] },
});

let runs = initialRuns();
let repos = initialRepos();

// Vuelve al estado inicial (los tests comparten el modulo).
export function resetFakeGh(): void {
  runs = initialRuns();
  repos = initialRepos();
}

function rollup(repo: FakeRepo): unknown[] {
  if (!repo.withChecks) return [];
  return runs.map((run) => ({
    __typename: 'CheckRun',
    name: run.name,
    workflowName: run.name,
    status: run.status.toUpperCase(),
    conclusion: run.conclusion.toUpperCase(),
    startedAt: '2026-09-30T19:33:02Z',
    completedAt: run.status === 'completed' ? '2026-09-30T19:34:57Z' : GO_ZERO,
    detailsUrl: `https://github.com/acme/demo/actions/runs/${run.id}`,
  }));
}

function fakePr(repoRef: string, branch: string): Record<string, unknown> {
  const repo = repos[repoRef]!;
  return {
    number: FAKE_PR_NUMBER,
    title: repo.title,
    state: repo.state,
    isDraft: repo.isDraft,
    url: `https://${repoRef}/pull/${FAKE_PR_NUMBER}`,
    headRefName: branch,
    headRefOid: repo.head,
    baseRefName: 'main',
    headRepositoryOwner: { login: 'acme' },
    isCrossRepository: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: repo.reviewDecision,
    autoMergeRequest: repo.autoMerge ? { mergeMethod: 'SQUASH' } : null,
    statusCheckRollup: rollup(repo),
    updatedAt: FAKE_DATE,
    author: FAKE_AUTHOR,
    body: `Cuerpo de la PR falsa de ${repoRef}`,
    latestReviews: repo.reviews,
    comments: repo.comments,
    files: [{ path: 'README.md', additions: 1, deletions: 0 }],
  };
}

// `--json a,b,c` deja solo esos campos, como gh.
function select(pr: Record<string, unknown>, args: readonly string[]): Record<string, unknown> {
  const flag = args.indexOf('--json');
  if (flag === -1) return pr;
  const fields = (args[flag + 1] ?? '').split(',');
  return Object.fromEntries(fields.filter((field) => field in pr).map((field) => [field, pr[field]]));
}

function valueOf(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  return index === -1 ? '' : (args[index + 1] ?? '');
}

function headOf(args: readonly string[]): string {
  return args.find((arg) => arg.startsWith('--head='))?.slice('--head='.length) ?? '';
}

function json(value: unknown): { code: number; stdout: string } {
  return { code: 0, stdout: JSON.stringify(value) };
}

const FAILED = { code: GH_EXIT_FAILED, stdout: '' };

function branchOf(repoRef: string): string {
  return repoRef === DEMO_REPO ? 'vg-pr' : 'vg-otro';
}

// `pr list -R`: el PR #7 del repo, filtrado por `--state` (`open` incluye borradores, como gh).
function listRepo(repoRef: string, args: readonly string[]): { code: number; stdout: string } {
  const repo = repos[repoRef];
  if (repo === undefined) return FAILED;
  const wanted = valueOf(args, '--state') || 'open';
  const matches = wanted === 'all' || repo.state.toLowerCase() === wanted;
  return json(matches ? [select(fakePr(repoRef, branchOf(repoRef)), args)] : []);
}

function mergeRepo(repo: FakeRepo, args: readonly string[]): { code: number; stdout: string } {
  const expected = valueOf(args, '--match-head-commit');
  const strategyRebase = args.includes('--rebase');
  if (args.includes('--disable-auto')) repo.autoMerge = false;
  else if ((expected !== '' && expected !== repo.head) || (strategyRebase && !repo.rebaseAllowed)) return FAILED;
  else if (args.includes('--auto')) repo.autoMerge = true;
  else repo.state = 'MERGED';
  return json('');
}

const REVIEW_STATES = [
  ['--approve', 'APPROVED'],
  ['--request-changes', 'CHANGES_REQUESTED'],
] as const;

function reviewRepo(repo: FakeRepo, args: readonly string[]): void {
  const state = REVIEW_STATES.find(([flag]) => args.includes(flag))?.[1] ?? 'COMMENTED';
  if (state !== 'COMMENTED') repo.reviewDecision = state;
  repo.reviews.push({ author: FAKE_AUTHOR, state, submittedAt: FAKE_DATE, body: valueOf(args, '-b') });
}

// Un comando del panel de PR (`-R host/owner/repo` explicito).
function answerRepoCommand(args: readonly string[]): { code: number; stdout: string } {
  const [group, verb] = args;
  const repoRef = group === 'repo' ? (args[2] ?? '') : valueOf(args, '-R');
  const repo = repos[repoRef];
  if (repo === undefined) return FAILED;
  if (group === 'repo' && verb === 'view') return json({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: repo.rebaseAllowed });
  if (args[2] !== String(FAKE_PR_NUMBER) && verb !== 'list') return FAILED;
  if (verb === 'view') return json(select(fakePr(repoRef, branchOf(repoRef)), args));
  if (verb === 'diff') return { code: 0, stdout: FAKE_PATCH };
  if (verb === 'merge') return mergeRepo(repo, args);
  if (verb === 'comment') repo.comments.push({ author: FAKE_AUTHOR, body: valueOf(args, '-b'), createdAt: FAKE_DATE });
  else if (verb === 'review') reviewRepo(repo, args);
  else if (verb === 'close') repo.state = 'CLOSED';
  else if (verb === 'reopen') repo.state = 'OPEN';
  else throw new Error(`gh falso: comando no previsto: ${args.join(' ')}`);
  return json('');
}

function answer(args: readonly string[]): { code: number; stdout: string } {
  if (args.includes('--admin')) throw new Error(`gh falso: --admin no debe llegar nunca: ${args.join(' ')}`);
  if (args.includes('-R') || args[0] === 'repo') return args[1] === 'list' ? listRepo(valueOf(args, '-R'), args) : answerRepoCommand(args);
  const [group, verb, target] = args;
  const demo = repos[DEMO_REPO]!;
  if (group === 'pr' && verb === 'list') {
    const head = headOf(args);
    if (head === NO_AUTH_BRANCH) return { code: GH_EXIT_NO_AUTH, stdout: '' };
    return json(head === NO_PR_BRANCH ? [] : [select(fakePr(DEMO_REPO, head), args)]);
  }
  if (group === 'pr' && verb === 'view') return json(select(fakePr(DEMO_REPO, 'vg-pr'), args));
  if (group === 'pr' && verb === 'merge') {
    demo.autoMerge = !args.includes('--disable-auto');
    return json('');
  }
  if (group === 'run' && verb === 'list') {
    return json(runs.map((run) => ({ databaseId: run.id, name: run.name, workflowName: run.name, status: run.status, conclusion: run.conclusion, url: `https://github.com/acme/demo/actions/runs/${run.id}`, attempt: 1, event: 'pull_request' })));
  }
  const run = runs.find((r) => String(r.id) === target);
  if (group === 'run' && run !== undefined && verb === 'rerun') Object.assign(run, { status: 'in_progress', conclusion: '' });
  else if (group === 'run' && run !== undefined && verb === 'cancel') Object.assign(run, { status: 'completed', conclusion: 'cancelled' });
  else throw new Error(`gh falso: comando no previsto: ${args.join(' ')}`);
  return json('');
}

export const runFakeGh: GhRunner = async (_bin, args) => answer(args);
