// F0.5 / H3: node spike/f0-claude-direct.mjs --real [--safe-mode]
// CLI externo por MAGE_F0_CLAUDE_BIN; BASE_ARGS se leen del adapter real. No importa el SDK.
// Copia auth de suscripción a un perfil NUEVO; el finally mata los hijos, detecta cambios y verifica
// retirada. Solo salen indicadores de fixtures, nunca texto recibido, IDs de sesión o credenciales.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cleanupProfile, credentialDigest } from './f0-profile-cleanup.mjs';

if (!process.argv.includes('--real')) throw new Error('--real obligatorio: cuatro operaciones con suscripción');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-f0-direct-004-'));
const profile = path.join(root, 'profile');
const credential = path.join(profile, '.credentials.json');
const children = [];
let initialDigest = null;
const safeMode = process.argv.includes('--safe-mode');
try {
  fs.mkdirSync(profile);
  const work = path.join(root, 'work'); fs.mkdirSync(work);
  const fixture = path.join(work, 'checkpoint.txt');
  fs.copyFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), credential);
  initialDigest = credentialDigest(credential);
  fs.writeFileSync(path.join(profile, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const source = fs.readFileSync('src/main/engine/claudeAdapter.ts', 'utf8');
  const baseSource = source.split('export const BASE_ARGS = [')[1].split('] as const')[0];
  const baseArgs = [...baseSource.matchAll(/^\s*'([^']+)',/gm)].map(match => match[1]);
  if (baseArgs.length !== 10) throw new Error('BASE_ARGS cambió; revisar el spike antes de medir');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profile, CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1' };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|OPENAI_API_KEY|CODEX_API_KEY|CLAUDECODE|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_SAFE_MODE)/.test(key)) delete env[key];
  }
  if (safeMode) env.CLAUDE_CODE_SAFE_MODE = '1';
  const bin = process.env.MAGE_F0_CLAUDE_BIN;
  if (!bin || !path.isAbsolute(bin)) throw new Error('MAGE_F0_CLAUDE_BIN absoluto obligatorio');
  const binaryVersion = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  console.log(JSON.stringify({ stage: 'launch', binaryVersion, transport: 'direct-stdin', baseArgs, safeMode, checkpointing: true, model: 'haiku', effort: 'low' }));
  const launch = (extraArgs) => {
    const child = spawn(bin, [...baseArgs, ...extraArgs, '--model', 'haiku', '--effort', 'low', '--permission-mode', 'default'],
      { cwd: work, env, windowsHide: true, stdio: 'pipe' });
    children.push(child); child.stderr.resume();
    let spawnError;
    child.on('error', error => { spawnError = error; });
    child.stdin.on('error', error => { spawnError = error; });
    const events = [];
    const send = (event) => child.stdin.write(JSON.stringify(event) + '\n');
    const control = (request) => {
      const id = randomUUID(); send({ type: 'control_request', request_id: id, request }); return id;
    };
    const user = (text) => {
      const uuid = randomUUID(); send({ type: 'user', uuid, session_id: '', parent_tool_use_id: null, message: { role: 'user', content: text } }); return uuid;
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      let event; try { event = JSON.parse(line); } catch { return; }
      events.push(event);
      if (event.type === 'system' && event.subtype === 'init') console.log(JSON.stringify({ stage: 'init', model: event.model }));
      if (event.type === 'control_request') {
        const input = event.request?.input ?? {};
        const name = event.request?.tool_name;
        const allowed = (name === 'Bash' && /^sleep (8|30)$/.test(input.command ?? '')) ||
          (['Read', 'Edit', 'Write'].includes(name) && path.resolve(work, input.file_path ?? '') === fixture);
        send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id,
          response: allowed ? { behavior: 'allow', updatedInput: input, toolUseID: event.request.tool_use_id } : { behavior: 'deny', message: 'Solo fixture sintética y sleep exacto' } } });
        console.log(JSON.stringify({ stage: 'permission', name, allowed }));
      }
    });
    const wait = async (predicate, label, from = 0) => {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        const index = events.findIndex((event, index) => index >= from && predicate(event));
        if (index >= 0) return { event: events[index], index };
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('CLI terminó antes de ' + label);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timeout ' + label);
    };
    return { child, events, send, control, user, wait };
  };
  const session = randomUUID();
  const q = launch(['--session-id', session]);
  const init = q.control({ subtype: 'initialize', hooks: {} });
  await q.wait(event => event.type === 'control_response' && event.response?.request_id === init, 'initialize');
  const firstId = q.user('Use Bash to execute exactly sleep 8. After it finishes reply only F0_FIRST. No other commands or files.');
  console.log(JSON.stringify({ stage: 'turn-attempt', purpose: 'active-message', message: 'U1' }));
  const sleepTool = event => event.type === 'assistant' && event.message?.content?.some(block => block.type === 'tool_use' && block.name === 'Bash');
  await q.wait(sleepTool, 'sleep8');
  await new Promise(resolve => setTimeout(resolve, 500));
  q.user('Correction while sleep is running: final reply only F0_STEERED instead of F0_FIRST. No new tools.');
  console.log(JSON.stringify({ stage: 'injected', message: 'U2', duringTool: true }));
  const active = await q.wait(event => event.type === 'result', 'active result');
  console.log(JSON.stringify({ stage: 'active-message', subtype: active.event.subtype, steered: active.event.result?.includes('F0_STEERED'), isError: active.event.is_error }));
  let from = q.events.length;
  q.user('Use Bash to execute exactly sleep 30, then reply only F0_NEVER. No other tools.');
  console.log(JSON.stringify({ stage: 'turn-attempt', purpose: 'interrupt', message: 'U3' }));
  await q.wait(sleepTool, 'sleep30', from);
  await new Promise(resolve => setTimeout(resolve, 500));
  const interrupted = q.control({ subtype: 'interrupt' });
  const receipt = await q.wait(event => event.type === 'control_response' && event.response?.request_id === interrupted, 'interrupt receipt', from);
  const interruptResult = await q.wait(event => event.type === 'result', 'interrupt result', from);
  console.log(JSON.stringify({ stage: 'interrupt', receipt: receipt.event.response.subtype, result: interruptResult.event.subtype, isError: interruptResult.event.is_error }));
  fs.writeFileSync(fixture, 'before\n'); from = q.events.length;
  const checkpointId = q.user('Read checkpoint.txt, then use Edit to change before to after. Reply only F0_EDITED. No Bash or other files.');
  console.log(JSON.stringify({ stage: 'turn-attempt', purpose: 'checkpoint', message: 'U4' }));
  await q.wait(event => event.type === 'result', 'checkpoint result', from);
  const modified = fs.readFileSync(fixture, 'utf8') === 'after\n';
  const rewindId = q.control({ subtype: 'rewind_files', user_message_id: checkpointId });
  const rewind = await q.wait(event => event.type === 'control_response' && event.response?.request_id === rewindId, 'rewind');
  console.log(JSON.stringify({ stage: 'rewind', modified, receipt: rewind.event.response.subtype, restored: fs.readFileSync(fixture, 'utf8') === 'before\n' }));
  q.child.stdin.end();
  await Promise.race([new Promise(resolve => q.child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (q.child.exitCode === null && q.child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(q.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else q.child.kill('SIGTERM');
  }
  const resumed = launch(['--resume', session, '--resume-session-at', firstId, '--fork-session']);
  const resumeInit = resumed.control({ subtype: 'initialize', hooks: {} });
  await resumed.wait(event => event.type === 'control_response' && event.response?.request_id === resumeInit, 'resume initialize');
  resumed.user('Check only the conversation history visible to you. Does it contain a user request to edit checkpoint.txt? If YES, reply only with the exact final reply marker specified in that request. If NO such request is present, reply exactly F0_ABSENT. Do not use tools or add explanations.');
  console.log(JSON.stringify({ stage: 'turn-attempt', purpose: 'resume-at-message', message: 'U5' }));
  const result = (await resumed.wait(event => event.type === 'result', 'resume result')).event;
  console.log(JSON.stringify({ stage: 'resume-at-message', subtype: result.subtype, isError: result.is_error,
    absent: result.result?.includes('F0_ABSENT'), laterMarker: result.result?.includes('F0_EDITED') }));
  resumed.child.stdin.end();
  if (!active.event.result?.includes('F0_STEERED') || receipt.event.response.subtype !== 'success' ||
    interruptResult.event.subtype !== 'error_during_execution' || !modified ||
    rewind.event.response.subtype !== 'success' || fs.readFileSync(fixture, 'utf8') !== 'before\n' ||
    !result.result?.includes('F0_ABSENT')) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ stage: 'failure', category: /Timeout/.test(error.message) ? error.message : error.code ?? error.name }));
  process.exitCode = 1;
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  cleanupProfile(root, credential, initialDigest);
}
