// F1.11 #53: ¿se anuncia la herramienta Artifact en una sesión lanzada como la lanza Mage (BASE_ARGS de
// claudeAdapter, stream-json de entrada)? Dos turnos reales mínimos: sin y con CLAUDE_CODE_ARTIFACT=1.
// Perfil nuevo copiado, carpeta desechable, uso consultado antes de cada turno y limpieza en finally.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { cleanupProfile, credentialDigest } from './f0-profile-cleanup.mjs';

const USAGE_LIMIT_PERCENT = 70;
const TURN_TIMEOUT_MS = 180_000;
const BASE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--allow-dangerously-skip-permissions'];

if (!process.argv.includes('--real')) throw new Error('--real obligatorio: este spike gasta turnos reales');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-f0-artifact-013-'));
const profile = path.join(root, 'profile');
const credential = path.join(profile, '.credentials.json');
let initial;
let turns = 0;

async function usageBelowLimit(version) {
  const auth = JSON.parse(fs.readFileSync(credential, 'utf8'));
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${auth.claudeAiOauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': `claude-code/${version}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`uso no disponible: HTTP ${response.status}`);
  const data = await response.json();
  const windows = ['five_hour', 'seven_day'].map(name => ({ name, percent: data[name]?.utilization }));
  console.log(JSON.stringify({ stage: 'usage', windows }));
  return windows.every(w => typeof w.percent === 'number' && w.percent <= USAGE_LIMIT_PERCENT);
}

function runTurn(bin, work, env) {
  const input = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Responde solo OK, sin herramientas.' }, parent_tool_use_id: null }) + '\n';
  const args = [...BASE_ARGS, '--model', 'haiku', '--effort', 'low', '--max-turns', '1', '--no-session-persistence'];
  const run = spawnSync(bin, args, { env, cwd: work, input, encoding: 'utf8', windowsHide: true, timeout: TURN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  const events = run.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const init = events.find(e => e.type === 'system' && e.subtype === 'init');
  const result = events.find(e => e.type === 'result');
  return { exit: run.status, artifactAdvertised: (init?.tools ?? []).includes('Artifact'), toolCount: init?.tools?.length ?? null, numTurns: result?.num_turns, cost: result?.total_cost_usd };
}

try {
  fs.mkdirSync(profile);
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  fs.copyFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), credential);
  initial = credentialDigest(credential);
  fs.writeFileSync(path.join(profile, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const bin = execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(p => p.endsWith('.exe'));
  const version = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).trim().split(' ')[0];
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profile };
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|CODEX_API_KEY|CLAUDECODE|CLAUDE_CODE_)/.test(key)) delete env[key];
  for (const variant of [{ name: 'sin-env', extra: {} }, { name: 'CLAUDE_CODE_ARTIFACT=1', extra: { CLAUDE_CODE_ARTIFACT: '1' } }]) {
    if (!(await usageBelowLimit(version))) { console.log(JSON.stringify({ variant: variant.name, pending: 'uso-sobre-70' })); continue; }
    turns++;
    console.log(JSON.stringify({ variant: variant.name, version, model: 'haiku', effort: 'low', ...runTurn(bin, work, { ...env, ...variant.extra }) }));
  }
  console.log(JSON.stringify({ realUserTurns: turns }));
} catch (error) {
  console.log(JSON.stringify({ stage: 'pending', category: error.code ?? error.name, realUserTurnsAttempted: turns }));
  process.exitCode = 1;
} finally {
  cleanupProfile(root, credential, initial);
}
