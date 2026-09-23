// Terminacion de un proceso hijo Y DE SUS DESCENDIENTES, multiplataforma.
//
// Por que existe: en Windows, `ChildProcess.kill()` (y cualquier señal) solo termina el hijo DIRECTO
// via TerminateProcess — no recorre el arbol. El CLI de Claude spawnea nietos de forma habitual: cada
// servidor MCP por stdio, cada `Bash` que ejecuta el agente y cada hook (la FASE 0 del grupo G censo un
// `powershell.exe` a t=1095 ms). Con `child.kill()` a secas esos nietos SOBREVIVEN al cierre de la
// pestaña y al de la propia app: siguen consumiendo recursos, mantienen abierta la transcripcion y en
// Windows bloquean el ejecutable (lo que ademas rompe cualquier actualizacion in-place).
//
// En Windows la unica forma fiable es `taskkill /PID <pid> /T /F` (`/T` = arbol, `/F` = forzar).
// En POSIX la señal se propaga al grupo de procesos de un hijo spawneado normalmente, asi que basta
// con la señal de siempre.

import { spawn as nodeSpawn } from 'node:child_process';

// Comando de Windows que recorre el arbol. Constante para no repetir el literal.
const TREE_KILL_COMMAND = 'taskkill';
const DEFAULT_SIGNAL: NodeJS.Signals = 'SIGTERM';

// Subconjunto de ChildProcess que hace falta aqui. Explicito para poder inyectar un doble en tests sin
// spawnear nada; `ChildProcessWithoutNullStreams` lo satisface estructuralmente.
export interface KillableChild {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
}

// Handle minimo del proceso lanzado para matar el arbol. Solo interesa enterarse de si fallo.
export interface KillerHandle {
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export interface KillTreeDeps {
  readonly platform: NodeJS.Platform;
  // Lanzador del comando de terminacion (Windows). Array de argumentos y SIN shell a proposito: el pid
  // es un entero nuestro, pero asi no hay forma de que llegue a un parser de shell aunque un dia lo sea.
  readonly spawnKiller: (command: string, args: readonly string[]) => KillerHandle;
}

// Plan resuelto: QUE hay que hacer para matar el arbol de este pid en este SO. Puro y testeable.
export type KillPlan =
  | { readonly strategy: 'none'; readonly reason: string }
  | { readonly strategy: 'signal'; readonly signal: NodeJS.Signals }
  | {
      readonly strategy: 'tree';
      readonly command: string;
      readonly args: readonly string[];
      readonly fallbackSignal: NodeJS.Signals;
    };

// Decide la estrategia. `pid` invalido -> 'none': un pid ausente significa que el proceso nunca llego a
// arrancar o ya murio, y uno <= 0 es directamente PELIGROSO en POSIX (`kill(0, sig)` señaliza a TODO el
// grupo de procesos del llamante, que incluye a Mage).
export function planKillProcessTree(
  platform: NodeJS.Platform,
  pid: number | undefined | null,
  signal: NodeJS.Signals = DEFAULT_SIGNAL,
): KillPlan {
  if (pid === undefined || pid === null) return { strategy: 'none', reason: 'sin pid' };
  if (!Number.isInteger(pid) || pid <= 0) {
    return { strategy: 'none', reason: `pid invalido: ${JSON.stringify(pid)}` };
  }
  if (platform !== 'win32') return { strategy: 'signal', signal };
  return {
    strategy: 'tree',
    command: TREE_KILL_COMMAND,
    args: ['/PID', String(pid), '/T', '/F'],
    fallbackSignal: signal,
  };
}

// Resultado de la terminacion, para poder loguearlo y para que los tests afirmen sobre el camino real.
export type KillOutcome = 'skipped' | 'tree' | 'signal';

// Mata el proceso y todos sus descendientes. Nunca lanza: se llama desde rutas de cierre (parar una
// sesion, cerrar la app) donde un throw dejaria a medias el resto de la limpieza. Un proceso que ya
// murio no es un error.
export function killProcessTree(
  child: KillableChild | null | undefined,
  deps: KillTreeDeps,
  signal: NodeJS.Signals = DEFAULT_SIGNAL,
): KillOutcome {
  if (child === null || child === undefined) return 'skipped';
  const plan = planKillProcessTree(deps.platform, child.pid, signal);
  if (plan.strategy === 'none') return 'skipped';
  if (plan.strategy === 'signal') {
    sendSignal(child, plan.signal);
    return 'signal';
  }
  try {
    const killer = deps.spawnKiller(plan.command, plan.args);
    // `taskkill` puede no existir (instalaciones recortadas de Windows) o fallar al lanzarse. El error
    // llega ASINCRONO por el evento 'error', asi que el try/catch por si solo no lo cubre.
    killer.on('error', () => sendSignal(child, plan.fallbackSignal));
    return 'tree';
  } catch {
    // Fallo SINCRONO al lanzar taskkill: al menos matamos el hijo directo, que es lo que hacia antes.
    sendSignal(child, plan.fallbackSignal);
    return 'signal';
  }
}

// Señal al hijo directo, tolerando que ya haya muerto (ESRCH) o que el handle este cerrado.
function sendSignal(child: KillableChild, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // El proceso ya no existe: es el resultado que buscabamos, no un fallo.
  }
}

// Dependencias reales (produccion). `windowsHide` para no abrir una consola al llamar a taskkill.
export function defaultKillTreeDeps(): KillTreeDeps {
  return {
    platform: process.platform,
    spawnKiller: (command, args) => nodeSpawn(command, [...args], { windowsHide: true, stdio: 'ignore' }),
  };
}
