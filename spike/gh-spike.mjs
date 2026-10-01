// Mage — Spike de P-027: forma REAL de los datos de PR, checks y workflows.
//
// Dos fuentes, en este orden:
//   1. `gh` si esta instalado (MAGE_GH_BIN o el PATH): version, si hay sesion y el JSON de
//      `pr list/view --json`, `pr checks --json` y `run list --json`, en SOLO LECTURA.
//   2. La API REST publica SIN credenciales: pulls, check-runs, combined status, actions/runs y las
//      cabeceras de rate limit.
//
// Nunca escribe en GitHub, nunca manda ni imprime un token: de `gh auth status` solo se queda con si
// hay sesion (codigo de salida) y descarta todas sus lineas. Imprime CLAVES y unos pocos campos, no
// cuerpos enteros.
// Uso: node spike/gh-spike.mjs [owner/repo] [numero-de-PR]   (por defecto cli/cli, publico y con datos)
//      MAGE_GH_FIXTURES=<carpeta> ademas guarda el JSON crudo de `pr list --head` y `run list` como
//      fixtures, con el dueño/repo cambiado por `acme/demo` y los ids de nodo borrados: son los de
//      `src/main/gh/__fixtures__/`.
// Medido el 2026-09-30 y el 2026-10-01 con gh 2.102.0 contra un PR de prueba en borrador.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.argv[2] ?? 'cli/cli';
const API = 'https://api.github.com';
const GH_TIMEOUT_MS = 30_000;

// Mismo orden que tendra `ghBinaryResolver`: override, rutas de Windows y PATH. Medido el 2026-09-30:
// el instalador deja `C:\Program Files\GitHub CLI\gh.exe` y un proceso ya abierto NO lo ve en el PATH.
function ghBin() {
  if (process.env.MAGE_GH_BIN) return process.env.MAGE_GH_BIN;
  if (process.platform === 'win32') {
    const candidates = [
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe'),
    ].filter(Boolean);
    const found = candidates.find((c) => existsSync(c));
    if (found) return found;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const name = process.platform === 'win32' ? 'gh.exe' : 'gh';
  return spawnSync(finder, [name], { stdio: 'ignore', windowsHide: true }).status === 0 ? name : null;
}

// Solo la PRIMERA linea de stderr, recortada: nunca se vuelca stderr entero (podria llevar una URL de
// remoto con credenciales). Nunca se llama a `auth token` ni se pasa `--show-token`.
function gh(bin, args, { cwd, env } = {}) {
  const t0 = Date.now();
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: GH_TIMEOUT_MS, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', ...env } });
  return { status: r.status, ms: Date.now() - t0, stdout: r.stdout ?? '', stderrFirstLine: (r.stderr ?? '').trim().split('\n')[0].slice(0, 160) };
}

function keysOf(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === 'object' ? Object.keys(first).sort() : [];
}

function report(label, r, pick = keysOf) {
  const body = r.status === 0 && r.stdout.trim().length > 0 ? pick(JSON.parse(r.stdout)) : r.stderrFirstLine;
  console.log(`${label}: exit=${r.status} ${r.ms}ms`, JSON.stringify(body));
}

// Sin `commits` ni `author`: traen correos. Es lo que necesita el chip de B1, en UNA llamada GraphQL.
// `headRefOid` (deduplicar el auto-fix por commit) y `autoMergeRequest` (null sin auto-merge) medidos el
// 2026-10-01; son los que pide Mage (`src/main/gh/ghParse.ts`).
const PR_FIELDS = 'number,title,state,isDraft,url,headRefName,headRefOid,baseRefName,headRepositoryOwner,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,autoMergeRequest,updatedAt';
const RUN_FIELDS = 'databaseId,name,displayTitle,status,conclusion,headBranch,headSha,event,url,workflowName,createdAt,updatedAt,startedAt,attempt,number';

function rollupSummary(pr) {
  const checks = pr.statusCheckRollup ?? [];
  return {
    typenames: [...new Set(checks.map((c) => c.__typename))],
    status: checks.map((c) => `${c.status ?? c.state}/${c.conclusion ?? ''}`),
    zeroCompletedAt: checks.some((c) => c.completedAt?.startsWith('0001-')),
  };
}

function measureGh(bin, pr) {
  console.log('## gh');
  console.log('version:', gh(bin, ['--version']).stdout.split('\n')[0]);
  // Solo el codigo de salida: las lineas de `auth status` pueden llevar el token enmascarado o no.
  console.log('sesion:', gh(bin, ['auth', 'status']).status === 0 ? 'si' : 'no');
  const R = ['-R', REPO];
  const list = gh(bin, ['pr', 'list', ...R, '--state', 'all', '--limit', '2', '--json', PR_FIELDS]);
  report('pr list', list);
  const number = pr ?? String(JSON.parse(list.stdout || '[{}]')[0]?.number ?? '');
  if (number.length > 0) measureGhPr(bin, R, number);
  const runs = gh(bin, ['run', 'list', ...R, '--limit', '3', '--json', RUN_FIELDS]);
  report('run list', runs, (r) => r.map((x) => `${x.event}:${x.headBranch}:${x.status}/${x.conclusion}`));
  const runId = JSON.parse(runs.stdout || '[{}]')[0]?.databaseId;
  if (runId) report('run view', gh(bin, ['run', 'view', String(runId), ...R, '--json', 'databaseId,status,conclusion,jobs,attempt']), (r) => ({ status: r.status, jobs: keysOf(r.jobs) }));
  measureGhFailures(bin);
}

function measureGhPr(bin, R, number) {
  const view = gh(bin, ['pr', 'view', number, ...R, '--json', PR_FIELDS]);
  report('pr view', view, (p) => ({ state: p.state, isDraft: p.isDraft, mergeable: p.mergeable, mergeStateStatus: p.mergeStateStatus, reviewDecision: p.reviewDecision, ...rollupSummary(p) }));
  const head = JSON.parse(view.stdout || '{}').headRefName;
  // La forma de B1 que no necesita parsear stderr: sale 0 con [] cuando la rama no tiene PR.
  if (head) report('pr list --head', gh(bin, ['pr', 'list', ...R, '--head', head, '--state', 'all', '--limit', '1', '--json', 'number,headRepositoryOwner,isCrossRepository']));
  const checks = gh(bin, ['pr', 'checks', number, ...R, '--json', 'name,state,bucket,link,workflow,startedAt,completedAt,event']);
  report('pr checks --json', checks, (c) => c.map((x) => `${x.bucket}/${x.state}`));
  if (head) {
    saveFixture('pr-list-head.json', gh(bin, ['pr', 'list', ...R, '--head', head, '--state', 'all', '--limit', '1', '--json', PR_FIELDS]));
    saveFixture('run-list.json', gh(bin, ['run', 'list', ...R, '--branch', head, '--limit', '3', '--json', RUN_FIELDS]));
  }
  // En modo texto sale 8 con checks pendientes (medido); con --json, 0.
  console.log('pr checks (texto): exit=', gh(bin, ['pr', 'checks', number, ...R]).status);
}

// Fixture anonimizado: el slug del repo pasa a `acme/demo` (en URLs y en el dueño) y se borran los ids
// de nodo de GraphQL. Nada de lo que se pide trae correos (`commits`/`author` no se piden nunca).
function saveFixture(name, r) {
  const dir = process.env.MAGE_GH_FIXTURES;
  if (!dir || r.status !== 0) return;
  const [owner, repo] = REPO.split('/');
  const text = r.stdout
    .replaceAll(`${owner}/${repo}`, 'acme/demo')
    .replaceAll(`"login":"${owner}"`, '"login":"acme"')
    .replace(/"id":"[^"]*",?/g, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  console.log('fixture:', join(dir, name));
}

// Codigos de salida de los estados que el chip tiene que distinguir. Sin sesion: GH_CONFIG_DIR vacio y
// sin GH_TOKEN. Sin red: un proxy a un puerto cerrado. Sin repo, sin remotos y remoto que no es de
// GitHub: carpetas temporales. `pr view` SIN numero en la carpeta, que es como lo lanzaria Mage.
function measureGhFailures(bin) {
  const base = mkdtempSync(join(tmpdir(), 'gh-spike-'));
  try {
    const cfg = join(base, 'cfg');
    mkdirSync(cfg);
    report('sin sesion', gh(bin, ['pr', 'view', '--json', 'number'], { env: { GH_CONFIG_DIR: cfg, GH_TOKEN: '', GITHUB_TOKEN: '' } }));
    report('sin red', gh(bin, ['pr', 'list', '-R', REPO, '--json', 'number'], { env: { HTTPS_PROXY: 'http://127.0.0.1:9' } }));
    report('sin repo', gh(bin, ['pr', 'view', '--json', 'number'], { cwd: base }));
    const noRemote = join(base, 'norem');
    spawnSync('git', ['init', '-q', noRemote]);
    report('sin remotos', gh(bin, ['pr', 'view', '--json', 'number'], { cwd: noRemote }));
    const gitlab = join(base, 'gl');
    spawnSync('git', ['init', '-q', gitlab]);
    spawnSync('git', ['-C', gitlab, 'remote', 'add', 'origin', 'https://gitlab.com/x/y.git']);
    report('remoto no GitHub', gh(bin, ['pr', 'view', '--json', 'number'], { cwd: gitlab }));
    report('rama sin PR (cwd del proceso)', gh(bin, ['pr', 'view', '--json', 'number']));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  const rate = { limit: res.headers.get('x-ratelimit-limit'), remaining: res.headers.get('x-ratelimit-remaining'), resource: res.headers.get('x-ratelimit-resource') };
  return { status: res.status, rate, etag: res.headers.get('etag') !== null, body: res.ok ? await res.json() : null };
}

async function measureRest() {
  console.log('## REST sin credenciales,', REPO);
  const pulls = await get(`/repos/${REPO}/pulls?state=open&per_page=1`);
  console.log('pulls:', pulls.status, 'rate', pulls.rate, 'etag', pulls.etag);
  const pr = pulls.body?.[0];
  if (pr === undefined) return;
  console.log('  claves de un PR de la lista:', keysOf(pr).join(','));
  console.log('  draft:', pr.draft, 'state:', pr.state, 'mergeable en la LISTA:', 'mergeable' in pr ? pr.mergeable : '(no viene)');
  const detail = await get(`/repos/${REPO}/pulls/${pr.number}`);
  console.log('pull detalle:', detail.status, 'mergeable:', detail.body?.mergeable, 'mergeable_state:', detail.body?.mergeable_state);
  const headOwner = pr.head.repo?.owner?.login ?? '(repo borrado)';
  console.log('  head desde un fork:', pr.head.repo?.fork === true, '(dueño del head distinto del repo:', headOwner !== REPO.split('/')[0], ')');
  const byBaseOwner = await get(`/repos/${REPO}/pulls?state=all&head=${REPO.split('/')[0]}:${pr.head.ref}&per_page=1`);
  console.log('pulls?head=<dueño del repo>:rama:', byBaseOwner.status, 'encontrados:', byBaseOwner.body?.length);
  const byHeadOwner = await get(`/repos/${REPO}/pulls?state=all&head=${headOwner}:${pr.head.ref}&per_page=1`);
  console.log('pulls?head=<dueño del head>:rama:', byHeadOwner.status, 'encontrados:', byHeadOwner.body?.length);
  // Peticion condicional: ¿un 304 gasta cupo sin credenciales?
  const first = await fetch(`${API}/repos/${REPO}/pulls/${pr.number}`, { headers: { Accept: 'application/vnd.github+json' } });
  const etag = first.headers.get('etag');
  const again = await fetch(`${API}/repos/${REPO}/pulls/${pr.number}`, { headers: { Accept: 'application/vnd.github+json', 'If-None-Match': etag ?? '' } });
  console.log('condicional:', first.status, '->', again.status, 'restantes', first.headers.get('x-ratelimit-remaining'), '->', again.headers.get('x-ratelimit-remaining'));
  const checkRuns = await get(`/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=3`);
  console.log('check-runs:', checkRuns.status, 'total:', checkRuns.body?.total_count, 'claves:', keysOf(checkRuns.body?.check_runs).join(','));
  const status = await get(`/repos/${REPO}/commits/${pr.head.sha}/status`);
  console.log('status combinado:', status.status, 'state:', status.body?.state, 'contextos:', status.body?.total_count);
  const reviews = await get(`/repos/${REPO}/pulls/${pr.number}/reviews?per_page=3`);
  console.log('reviews:', reviews.status, 'n:', reviews.body?.length, 'estados:', [...new Set((reviews.body ?? []).map((r) => r.state))].join(','));
  const runs = await get(`/repos/${REPO}/actions/runs?branch=${encodeURIComponent(pr.head.ref)}&per_page=2`);
  console.log('actions/runs?branch:', runs.status, 'total:', runs.body?.total_count, 'claves:', keysOf(runs.body?.workflow_runs).join(','));
  console.log('rate tras las llamadas:', runs.rate);
}

// Visibilidad de los repos de Mage: sin credenciales, uno privado da 404 (no 403).
async function measureVisibility() {
  for (const repo of ['M4raa/mage_porter', 'M4raa/mage']) {
    const r = await get(`/repos/${repo}`);
    console.log('repo', repo, '->', r.status, r.body === null ? '' : `privado=${r.body.private} rama=${r.body.default_branch}`);
  }
}

const bin = ghBin();
await measureVisibility();
console.log('fecha:', new Date().toISOString(), 'plataforma:', process.platform, 'node:', process.version);
if (bin === null) console.log('## gh: NO instalado (ni MAGE_GH_BIN ni en el PATH)');
else measureGh(bin, process.argv[3]);
await measureRest();
