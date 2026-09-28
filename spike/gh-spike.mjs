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
// Uso: node spike/gh-spike.mjs [owner/repo]   (por defecto cli/cli, publico y con datos)

import { spawnSync } from 'node:child_process';

const REPO = process.argv[2] ?? 'cli/cli';
const API = 'https://api.github.com';
const GH_TIMEOUT_MS = 30_000;

function ghBin() {
  if (process.env.MAGE_GH_BIN) return process.env.MAGE_GH_BIN;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const name = process.platform === 'win32' ? 'gh.exe' : 'gh';
  return spawnSync(finder, [name], { stdio: 'ignore', windowsHide: true }).status === 0 ? name : null;
}

function gh(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: GH_TIMEOUT_MS, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
  return { status: r.status, stdout: r.stdout ?? '', stderrFirstLine: (r.stderr ?? '').split('\n')[0] };
}

function keysOf(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === 'object' ? Object.keys(first).sort() : [];
}

function measureGh(bin) {
  console.log('## gh');
  console.log('version:', gh(bin, ['--version']).stdout.split('\n')[0]);
  // Solo el codigo de salida: las lineas de `auth status` pueden llevar el token enmascarado o no.
  console.log('sesion:', gh(bin, ['auth', 'status']).status === 0 ? 'si' : 'no');
  const prFields = 'number,title,state,isDraft,url,headRefName,baseRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup';
  const list = gh(bin, ['pr', 'list', '-R', REPO, '--limit', '2', '--json', prFields]);
  console.log('pr list:', list.status, list.status === 0 ? keysOf(JSON.parse(list.stdout)) : list.stderrFirstLine);
  const checks = gh(bin, ['pr', 'checks', '-R', REPO, String(JSON.parse(list.stdout || '[{}]')[0]?.number ?? ''), '--json', 'name,state,bucket,link,workflow']);
  console.log('pr checks:', checks.status, checks.status === 0 ? keysOf(JSON.parse(checks.stdout)) : checks.stderrFirstLine);
  const runs = gh(bin, ['run', 'list', '-R', REPO, '--limit', '2', '--json', 'databaseId,name,status,conclusion,headBranch,event,url,workflowName,createdAt']);
  console.log('run list:', runs.status, runs.status === 0 ? keysOf(JSON.parse(runs.stdout)) : runs.stderrFirstLine);
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
else measureGh(bin);
await measureRest();
