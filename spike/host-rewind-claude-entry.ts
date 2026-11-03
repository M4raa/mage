// Spike del punto de control cp/M-01 (carril M, host 1.4): el rewind por el HOST (`session.rewindPoints`,
// `session.rewindPlan`, `session.rewind`) con el código REAL de Mage contra el CLI real de Claude y un servidor
// Anthropic FALSO. Mismo montaje que `rewind-claude-entry.ts` (se reutilizan su `Rig` y su `Live`), pero las órdenes
// viajan por un `HostConnection` real con un transporte en memoria, como las mandaría `mage chat`.
// Sin cuota (clave falsa, servidor local) y con carpetas temporales `mage-m-` que se borran. La salida solo lleva
// booleanos, recuentos y nombres de campo: nunca credenciales ni textos del usuario.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTranslator } from '@shared/i18n/translator';
import { HostConnection, type HostTransport } from '../src/main/host/hostConnection';
import type { HostControl } from '../src/main/host/hostControl';
import { HOST_PROTOCOL } from '../src/main/host/hostProtocol';
// @ts-expect-error servidor falso en JS, sin tipos
import { startFakeAnthropic } from '../scripts/fake-anthropic-messages.mjs';
import { CLAUDE_MOUNT, Rig, claudeBinary, errorText, rm, type Fake, type Live, type Rec } from './rewind-claude-entry';

export { claudeBinary };

const TOKEN = 'a'.repeat(64);
const REPLY_TIMEOUT_MS = 120_000;
const TURN_TIMEOUT_MS = 120_000;
const SETTLE_MS = 300;
const INVALID_PARAMS = -32602;

type Line = Record<string, any>;

// Un cliente del host sobre un transporte en memoria: `write` acumula las líneas que el host manda y `receive` mete las del cliente.
class HostClient {
  private readonly written: string[] = [];
  private readonly connection: HostConnection;
  private nextId = 1;

  constructor(private readonly rig: Rig) {
    const transport: HostTransport = { write: (data) => { this.written.push(data); }, end: () => undefined, bufferedBytes: () => 0 };
    this.connection = new HostConnection(transport, {
      sessions: rig.coordinator, rewind: rig.rewind, control: {} as HostControl, token: TOKEN, hostVersion: 'spike', mode: 'headless',
      log: () => undefined, newId: () => randomUUID(), translate: createTranslator('es'), setTimer: () => () => undefined,
    });
  }

  lines(): readonly Line[] {
    return this.written.join('').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Line);
  }

  async call(method: string, params: unknown): Promise<Line> {
    const id = this.nextId++;
    this.connection.receive(Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`));
    await this.rig.until(() => this.lines().some((line) => line.id === id), `respuesta a ${method}`, REPLY_TIMEOUT_MS);
    return this.lines().find((line) => line.id === id) as Line;
  }

  async hello(): Promise<Line> {
    return this.call('hello', { protocol: HOST_PROTOCOL, client: { kind: 'terminal', version: 'spike' }, token: TOKEN });
  }

  notifications(kind: string): number {
    return this.lines().filter((line) => line.method === 'event' && line.params?.event?.kind === kind).length;
  }

  close(): void {
    this.connection.closed();
  }
}

// La última petición que el «modelo» recibió y cuyo último mensaje contiene `marker`, como un solo texto.
function requestText(fake: Fake, marker: string): string {
  const tag = `T(${marker})`;
  const found = [...fake.requests].reverse().find((request) => (request.messages.at(-1) ?? '').includes(tag));
  return found === undefined ? '' : found.messages.join('\n');
}

// Un mensaje por `session.send` del host y espera a que acabe el turno.
async function hostTurn(rig: Rig, host: HostClient, live: Live, text: string): Promise<string> {
  const commandId = randomUUID();
  const before = live.results().length;
  await host.call('session.send', { sessionId: live.sessionId, text, commandId });
  await rig.until(() => live.results().length > before && live.state() === 'idle', `turno «${text}»`, TURN_TIMEOUT_MS);
  return commandId;
}

interface HostPoint { readonly userIndex: number; readonly text: string; readonly nativeId: string | null; readonly rewindable: boolean }

async function hostCases(rig: Rig, cwd: string, fake: Fake): Promise<Rec> {
  const live = rig.open(cwd);
  const host = new HostClient(rig);
  try {
    await host.hello();
    const sentIds = [await hostTurn(rig, host, live, 'ECO uno'), await hostTurn(rig, host, live, 'ECO dos')];
    const pointsReply = await host.call('session.rewindPoints', { sessionId: live.sessionId });
    const points = (pointsReply.result?.points ?? []) as readonly HostPoint[];
    const h1 = {
      replyError: pointsReply.error?.code ?? null,
      pointCount: points.length,
      allWithNativeId: points.every((p) => typeof p.nativeId === 'string'),
      nativeIdsAreCommandIds: points.every((p, i) => p.nativeId === sentIds[i]),
      allRewindable: points.every((p) => p.rewindable === true),
    };
    const first = points[0];
    if (first === undefined) return { h1 };
    const point = { userIndex: first.userIndex, text: first.text, nativeId: first.nativeId };

    const planReply = await host.call('session.rewindPlan', { sessionId: live.sessionId, point, action: 'rewind' });
    const h2 = { replyError: planReply.error?.code ?? null, unavailableNull: planReply.result?.unavailable === null, discardedMessages: planReply.result?.discardedMessages ?? null };

    const withAttachments = await host.call('session.rewind', { sessionId: live.sessionId, point, action: 'rewind', restoreFiles: false, saveCopy: false, attachments: [] });
    const h4 = { errorCode: withAttachments.error?.code ?? null, isInvalidParams: withAttachments.error?.code === INVALID_PARAMS };

    const subscribed = await host.call('session.subscribe', { sessionId: live.sessionId });
    const rewound = await host.call('session.rewind', { sessionId: live.sessionId, point, action: 'rewind', restoreFiles: false, saveCopy: false });
    await hostTurn(rig, host, live, 'ECO tras');
    const afterRequest = requestText(fake, 'ECO tras');
    const h3 = {
      replyError: rewound.error?.code ?? null,
      hasProjectionKey: Object.hasOwn(rewound.result ?? {}, 'projection'),
      draftIsFirstMessage: rewound.result?.draft === first.text,
      nextRequestHasUno: afterRequest.includes('ECO uno'),
      nextRequestHasDos: afterRequest.includes('ECO dos'),
    };
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const h5 = { subscribed: subscribed.error === undefined, rewoundNotifications: host.notifications('conversation_rewound') };
    return { h1, h2, h3, h4, h5, permissionErrors: live.permissionErrors.length };
  } finally {
    host.close();
  }
}

export async function run(): Promise<Rec> {
  const real = (prefix: string): string => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  const cfg = real('mage-m-claude-cfg-');
  const stateDir = real('mage-m-claude-state-');
  const cwd = real('mage-m-claude-cwd-');
  mkdirSync(join(cfg, 'projects'), { recursive: true });
  writeFileSync(join(cfg, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const rig = new Rig({ ...CLAUDE_MOUNT, accountDir: cfg, stateDir, keepAlive: null, virtualTimers: false });
  const fake = (await startFakeAnthropic({ cwd })) as Fake;
  rig.fakeUrl = fake.url;
  try {
    return { casos: await hostCases(rig, cwd, fake) };
  } catch (err) {
    return { casos: {}, error: errorText(err) };
  } finally {
    await rig.stopAll();
    await fake.close();
    rm(cfg);
    rm(stateDir);
    rm(cwd);
  }
}
