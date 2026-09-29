// Arnes COMPARTIDO de los tests de AgentSession (Fase 7.12). No es un fichero de test: vitest solo
// recoge `*.test.ts`, asi que esto no se ejecuta solo — se importa.
//
// Vive aqui, junto al modulo que prueba, y no en `src/testing/`, a proposito: `src/testing/` es para
// fixtures que cruzan modulos (una `TranscriptEntry`); esto conoce la superficie intima de
// `AgentSession` (su SpawnFn, sus timers, su killTree) y no le sirve a nadie mas.
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { AgentSession, type SpawnFn, type TimerHandle } from './agentSession';
import type { LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan } from './providerAdapter';
import type { RestartPolicy } from './restartPolicy';

// --- Dobles ---------------------------------------------------------------------------------------

// Stream de mentira: EventEmitter + el setEncoding que AgentSession llama.
export class FakeStream extends EventEmitter {
  setEncoding(): void {
    // no-op: los tests emiten strings directamente
  }
}

// Proceso hijo de mentira con la superficie que usa AgentSession. Lleva `pid` a proposito: sin el,
// `killProcessTree` lo descartaria por "sin pid" y los tests de parada pasarian en VACIO.
export class FakeChild extends EventEmitter {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly stdin = { write: vi.fn(), end: vi.fn() };
  readonly kill = vi.fn();
  readonly pid = FAKE_PID;

  exit(code: number | null, signal: string | null = null): void {
    this.emit('exit', code, signal);
  }
}

// Pid de mentira. Los tests SIEMPRE inyectan `killTree`: con las deps reales, en Windows esto lanzaria
// un `taskkill /T /F` de verdad contra el proceso que tuviera ese pid en la maquina.
export const FAKE_PID = 4242;

// Adapter de mentira: registra con que params se pidio cada plan (para ver si se reanuda o no) y
// normaliza una linea trivial a un evento reconocible.
export function fakeAdapter(): { adapter: ProviderAdapter; plans: LaunchParams[] } {
  const plans: LaunchParams[] = [];
  const adapter: ProviderAdapter = {
    // `auth` es obligatorio en ProviderAdapter (9.1). Estas sesiones no autentican nada, asi que
    // declaran el modelo mas honesto: la sesion del proveedor vive fuera de Mage.
    auth: { kind: 'external', reason: 'adapter de prueba' },
    buildSpawnPlan: (params): SpawnPlan => {
      plans.push(params);
      const args = params.resume === true ? ['--resume', params.sessionId] : ['--session-id', params.sessionId];
      return { command: 'claude', args, env: {} };
    },
    encodeUserMessage: (text) => ({ text }),
    encodePermissionResponse: (ref: PermissionRef, decision: PermissionDecision) => ({ ref, decision }),
    encodeInterrupt: () => ({ interrupt: true }),
    encodeSetModel: (model) => ({ model }),
    encodeSetPermissionMode: (mode) => ({ mode }),
    encodeStopTask: (taskId) => ({ stopTask: taskId }),
    // Con `request_id` en la raiz, como los control_request de verdad: AgentSession lo lee de ahi para
    // saber que respuestas de error son suyas.
    encodeGetContextUsage: () => ({
      type: 'control_request',
      request_id: 'own-ctx',
      request: { subtype: 'get_context_usage' },
    }),
    encodeInitialize: () => ({
      type: 'control_request',
      request_id: 'own-init',
      request: { subtype: 'initialize' },
    }),
    encodeHookResponse: (requestId) => ({ subtype: 'hook_response', requestId }),
    normalize: (raw) => (raw as { events?: MageEvent[] }).events ?? [],
  };
  return { adapter, plans };
}

export const POLICY: RestartPolicy = { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 4_000, healthyUptimeMs: 60_000 };

export interface Harness {
  readonly session: AgentSession;
  readonly events: MageEvent[];
  readonly children: FakeChild[];
  readonly plans: LaunchParams[];
  readonly timers: Array<{ callback: () => void; delayMs: number }>;
  readonly cleared: TimerHandle[];
  readonly treeKills: Array<{ command: string; args: readonly string[] }>;
  runPendingTimer: () => void;
  advanceClock: (ms: number) => void;
}

// `custom` permite inyectar otro adapter (p.ej. el de modo perTurn) sin duplicar el arnes entero.
export function harness(custom?: { readonly adapter: ProviderAdapter; readonly plans: LaunchParams[] }): Harness {
  const { adapter, plans } = custom ?? fakeAdapter();
  const events: MageEvent[] = [];
  const children: FakeChild[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const cleared: TimerHandle[] = [];
  const treeKills: Array<{ command: string; args: readonly string[] }> = [];
  let clock = 1_000;

  const spawn: SpawnFn = () => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ReturnType<SpawnFn>;
  };

  const session = new AgentSession({
    adapter,
    params: { sessionId: 's1', accountDir: '/home/u/.claude', model: 'sonnet', cwd: '/proj' },
    emit: (event) => events.push(event),
    spawn,
    // Windows a proposito: es el SO donde la terminacion del arbol NO es lo mismo que kill().
    killTree: {
      platform: 'win32',
      spawnKiller: (command, args) => {
        treeKills.push({ command, args });
        return { on: () => undefined };
      },
    },
    restartPolicy: POLICY,
    setTimer: (callback, delayMs) => {
      timers.push({ callback, delayMs });
      return timers.length - 1;
    },
    clearTimer: (handle) => cleared.push(handle),
    now: () => clock,
  });

  return {
    session,
    events,
    children,
    plans,
    timers,
    cleared,
    treeKills,
    runPendingTimer: () => {
      const pending = timers[timers.length - 1];
      if (pending === undefined) throw new Error('no habia timer pendiente');
      pending.callback();
    },
    advanceClock: (ms) => {
      clock += ms;
    },
  };
}

// Emite una linea NDJSON por el stdout del hijo indicado.
export function emitLine(child: FakeChild, events: MageEvent[]): void {
  child.stdout.emit('data', `${JSON.stringify({ events })}\n`);
}

// Peticion de permiso de referencia (7.7). El `toolUseId` es lo que la sesion tiene que recordar
// para poder responder: no viaja en la decision del usuario.
export const PERMISO_R1 = {
  kind: 'permission_request',
  request: {
    requestId: 'r1',
    toolUseId: 't1',
    toolName: 'Write',
    input: {},
    description: 'crear out.txt',
    requiresUserInteraction: false,
    displayName: null,
  },
} as const;

// Lineas NDJSON que la sesion escribio al stdin del hijo indicado.
export function written(child: FakeChild): unknown[] {
  return child.stdin.write.mock.calls.map(([line]) => JSON.parse(String(line)));
}
