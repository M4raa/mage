// Spike de F4.1: el directo de Claude con el código REAL de Mage (ClaudeAdapter) contra el CLI real y un servidor Anthropic
// FALSO (sin cuota, clave falsa). Lo empaqueta y lo lanza `steer-claude.mjs`. La salida solo lleva outcomes y recuentos.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { ClaudeAdapter, BASE_ARGS } from '../src/main/engine/claudeAdapter';
import { resolveClaudeBinary } from '../src/main/os/claudeBinaryResolver';
import { scrubAgentEnv } from '../src/main/os/agentEnv';
import type { MageEvent } from '@shared/events';
// @ts-expect-error servidor falso en JS, sin tipos
import { startFake } from './steer-fake-anthropic.mjs';

const MODEL = 'claude-haiku-4-5';
const FAKE_API_KEY = 'sk-ant-fake-mage-spike';
const POLL_MS = 100;
const WAIT_MS = 60_000;
const SETTLE_AFTER_FIRST_RESULT_MS = 20_000;
const BEFORE_STEER_MS = 1200;
const PERMISSION_WAIT_MS = 2000;
const RESULTS_EXPECTED = 2;

type Raw = Record<string, any>;
interface CaseSpec { readonly mode: string; readonly first: string; readonly trigger: (raw: Raw) => boolean; readonly answersPermission: boolean }

const isToolUse = (raw: Raw): boolean => raw.type === 'assistant' && Array.isArray(raw.message?.content) && raw.message.content.some((b: Raw) => b.type === 'tool_use');
const isDelta = (raw: Raw): boolean => raw.type === 'stream_event' && raw.event?.type === 'content_block_delta';
const isPermission = (raw: Raw): boolean => raw.type === 'control_request' && raw.request?.subtype === 'can_use_tool';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Un proceso de `claude` como lo lanza Mage: sus líneas por el adapter, y lo que escribimos, codificado por el adapter.
class ClaudeProcess {
  readonly adapter = new ClaudeAdapter();
  readonly raws: Raw[] = [];
  readonly steers: MageEvent[] = [];
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(cwd: string, cfg: string, fakeUrl: string, mode: string) {
    const args = [...BASE_ARGS, '--session-id', randomUUID(), '--model', MODEL, '--permission-mode', mode];
    // El saneado va PRIMERO y luego las variables del falso: es un proceso del spike, no de Mage.
    const env = { ...scrubAgentEnv(process.env), CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_BASE_URL: fakeUrl, ANTHROPIC_API_KEY: FAKE_API_KEY };
    this.child = spawn(resolveClaudeBinary(), args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
  }

  write(payload: unknown): void {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  // Directo: el payload sale tal cual lo codifica el adapter (con su uuid).
  steer(text: string): void {
    const encoding = this.adapter.encodeSteer(randomUUID(), text);
    if (encoding.kind !== 'write') throw new Error(`encodeSteer no devolvio un payload: ${JSON.stringify(encoding)}`);
    this.write(encoding.payload);
  }

  async waitFor(found: (raw: Raw) => boolean, timeoutMs: number = WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.raws.some(found)) {
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
    return true;
  }

  results(): number {
    return this.raws.filter((raw) => raw.type === 'result').length;
  }

  close(): void {
    if (this.child.exitCode === null && this.child.pid !== undefined) process.kill(this.child.pid);
  }

  private receive(line: string): void {
    let raw: Raw;
    try {
      raw = JSON.parse(line) as Raw;
    } catch {
      return; // avisos del CLI que no son JSON
    }
    this.raws.push(raw);
    for (const event of this.adapter.normalize(raw)) if (event.kind === 'steer_result') this.steers.push(event);
  }
}

// Espera el primer `result` y luego el segundo, con un tope de SETTLE_AFTER_FIRST_RESULT_MS.
async function waitForResults(proc: ClaudeProcess): Promise<void> {
  if (!(await proc.waitFor((raw) => raw.type === 'result'))) throw new Error('el CLI no produjo ningun result');
  const deadline = Date.now() + SETTLE_AFTER_FIRST_RESULT_MS;
  while (proc.results() < RESULTS_EXPECTED && Date.now() < deadline) await sleep(POLL_MS);
}

// Contesta el permiso pendiente del caso `permisoPendiente` con el adapter, como lo haría la UI al aceptar.
function answerPermission(proc: ClaudeProcess): void {
  const raw = proc.raws.find(isPermission);
  if (raw === undefined) throw new Error('no hay control_request can_use_tool que contestar');
  const response = proc.adapter.encodePermissionResponse(
    { requestId: String(raw.request_id), toolUseId: String(raw.request.tool_use_id) },
    { behavior: 'allow', updatedInput: raw.request.input },
  );
  proc.write(response);
}

async function runCase(spec: CaseSpec): Promise<Record<string, unknown>> {
  const root = mkdtempSync(join(tmpdir(), 'mage-g-steer-claude-'));
  const cwd = join(root, 'w');
  const cfg = join(root, 'cfg');
  mkdirSync(cwd);
  mkdirSync(cfg);
  writeFileSync(join(cfg, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const fake = await startFake({ cwd });
  const proc = new ClaudeProcess(cwd, cfg, fake.url, spec.mode);
  try {
    proc.write(proc.adapter.encodeUserMessage(spec.first));
    if (!(await proc.waitFor(spec.trigger))) throw new Error(`el CLI no llego al punto del directo (${spec.first})`);
    await sleep(spec.answersPermission ? 0 : BEFORE_STEER_MS);
    proc.steer('ECO BETA');
    if (spec.answersPermission) {
      await sleep(PERMISSION_WAIT_MS);
      answerPermission(proc);
    }
    await waitForResults(proc);
    return {
      steer: proc.steers.map((event) => (event.kind === 'steer_result' ? event.outcome : null)),
      results: proc.results(),
      inferred: proc.steers.some((event) => event.kind === 'steer_result' && event.inferred === true),
    };
  } finally {
    proc.close();
    await fake.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

export function claudeBinary(): string {
  return resolveClaudeBinary();
}

export async function run(): Promise<Record<string, unknown>> {
  const absorbido = await runCase({ mode: 'acceptEdits', first: 'SLEEP', trigger: isToolUse, answersPermission: false });
  const turnoPropio = await runCase({ mode: 'acceptEdits', first: 'SLOW', trigger: isDelta, answersPermission: false });
  const permisoPendiente = await runCase({ mode: 'default', first: 'WRITE p.txt UNO', trigger: isPermission, answersPermission: true });
  return { casos: { absorbido, turnoPropio, permisoPendiente } };
}
