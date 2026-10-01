import type { GhRunner } from './ghService';

// `gh` FALSO para `verify:gui`, activo solo con MAGE_GH_FAKE=1 (mismo patron que MAGE_MCP_FAKE_CLI: en
// proceso, sin spawnear nada, porque Node no lanza `.cmd` sin shell). Contesta con la FORMA medida en gh
// 2.102.0 y guarda estado para que una accion se vea en la siguiente lectura: relanzar pone el run en
// marcha, cancelar lo cancela y el auto-merge se enciende y se apaga. Nunca habla con GitHub.
//
// Por rama: `main` no tiene PR (para «Crear PR»), `vg-sin-sesion` sale como si gh no tuviera sesion (4) y
// cualquier otra tiene el PR #7 en borrador, con un check roto, otro en marcha y otro que pasa.

export const FAKE_GH_BIN = 'gh-falso';
export const FAKE_PR_NUMBER = 7;
const NO_PR_BRANCH = 'main';
const NO_AUTH_BRANCH = 'vg-sin-sesion';
const GH_EXIT_NO_AUTH = 4;
const GO_ZERO = '0001-01-01T00:00:00Z';

interface FakeRun {
  readonly id: number;
  readonly name: string;
  status: string;
  conclusion: string;
}

const runs: FakeRun[] = [
  { id: 101, name: 'check', status: 'completed', conclusion: 'failure' },
  { id: 102, name: 'lint', status: 'in_progress', conclusion: '' },
];
let autoMerge = false;

function fakePr(branch: string): Record<string, unknown> {
  const [check, lint] = runs;
  return {
    number: FAKE_PR_NUMBER,
    title: 'VG: PR falso de verify:gui',
    state: 'OPEN',
    isDraft: true,
    url: `https://github.com/acme/demo/pull/${FAKE_PR_NUMBER}`,
    headRefName: branch,
    headRefOid: '0123456789abcdef0123456789abcdef01234567',
    baseRefName: 'main',
    headRepositoryOwner: { login: 'acme' },
    isCrossRepository: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: '',
    autoMergeRequest: autoMerge ? { mergeMethod: 'SQUASH' } : null,
    statusCheckRollup: [check!, lint!].map((run) => ({
      __typename: 'CheckRun',
      name: run.name,
      workflowName: run.name,
      status: run.status.toUpperCase(),
      conclusion: run.conclusion.toUpperCase(),
      startedAt: '2026-09-30T19:33:02Z',
      completedAt: run.status === 'completed' ? '2026-09-30T19:34:57Z' : GO_ZERO,
      detailsUrl: `https://github.com/acme/demo/actions/runs/${run.id}`,
    })),
  };
}

function headOf(args: readonly string[]): string {
  return args.find((arg) => arg.startsWith('--head='))?.slice('--head='.length) ?? '';
}

function json(value: unknown): { code: number; stdout: string } {
  return { code: 0, stdout: JSON.stringify(value) };
}

function answer(args: readonly string[]): { code: number; stdout: string } {
  const [group, verb, target] = args;
  if (group === 'pr' && verb === 'list') {
    const head = headOf(args);
    if (head === NO_AUTH_BRANCH) return { code: GH_EXIT_NO_AUTH, stdout: '' };
    return json(head === NO_PR_BRANCH ? [] : [fakePr(head)]);
  }
  if (group === 'pr' && verb === 'view') return json(fakePr('vg-pr'));
  if (group === 'pr' && verb === 'merge') {
    autoMerge = !args.includes('--disable-auto');
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
