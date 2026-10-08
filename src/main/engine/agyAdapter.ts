import { homedir } from 'node:os';
import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { AGY_EFFORT_LEVELS, AGY_PERMISSION_MODES } from '@shared/providers';
import { resolveAgyBinary } from '../os/agyBinaryResolver';
import { AgyTurnTracker } from './agyNormalize';
import { AGY_FILE_TOKEN_ENV, type AgyProfileMode } from './agyProfile';
import type { AuthModel, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan } from './providerAdapter';
import { scrubAgentEnv } from '../os/agentEnv';

// Adapter del CLI de Antigravity (`agy`) como motor NATIVO (E3). Por defecto consume la SUSCRIPCION de
// Google con el login propio de `agy`; una cuenta de agy POR CLAVE (grupo E) lleva su `GEMINI_API_KEY`.
// Las dos corren con un perfil (`USERPROFILE`) propio de Mage: la de clave, el de su cuenta; la de
// suscripcion, uno comun (el login de agy no vive en el perfil, medido). Ver agyProfile.ts.
//
// SESION PERSISTENTE desde la 0.1.2: `agy` estreno `--input-format stream-json` en la 1.1.15. Medido en
// 1.2.14 (`node spike/agy-spike.mjs --persistent`): un proceso por pestaña, una linea
// `{"event":"user","message":{"content":"…"}}` por mensaje, un `result` por turno, el mismo
// `conversation_id` y el contexto conservado; los mensajes con un turno en curso se ENCOLAN en el CLI.
//   - El `usage` del `result` es ACUMULADO por proceso: lo resta `AgyTurnTracker` (agyNormalize.ts).
//   - No hay interrupcion por stdin (`interrupt`/`cancel` se ignoran; `control_request` esta reservado):
//     el adapter declara `interruptsByKill` y AgentSession mata el arbol. El siguiente mensaje relanza con
//     `--conversation <id>`: la conversacion sobrevive al corte (medido) y el uso vuelve a contar de 0.
//   - `content` solo admite bloques `text` («only "text"», medido): las imagenes se guardan en disco y
//     el mensaje lleva su ruta; el agente las abre con `view_file` (medido: contesto bien el color).
//
// ponytail: TECHO deliberado, con el camino para subirlo:
//   - El `conversation_id` no sobrevive a reiniciar Mage: se sube guardandolo en la Tab del
//     workspace-state.json y pasandolo como `conversationId` al crear la sesion.
//   - Reconstruir el hilo al reabrir la pestana: `agy` deja un fichero por conversacion en
//     ~/.gemini/antigravity-cli/conversations (.db/.pb, formato propio).
//   - Permisos REALES: el CLI no tiene puente (no hay --permission-prompt-tool). Las reglas
//     allow/deny por comando exacto se escriben en el settings.json del perfil antes de lanzar; agy las
//     lee al arrancar (medido), asi que valen para la conversacion siguiente o el relanzado tras un corte.
//   - Las conversaciones de agy viven en su perfil (`--conversation` solo reanuda dentro del mismo, medido):
//     las de antes de la 0.1.2, del perfil real, no se ven. No se pierde nada que Mage reanudara: el id no
//     sobrevive a reiniciar Mage (primer punto).

// Argumentos fijos. `--output-format stream-json` NO exige `--verbose` (ese flag no existe en `agy`).
// Sin `--print-timeout`: desde la 1.2.6 el tope por defecto es ILIMITADO, y el `30m` que se pasaba antes
// cortaba los turnos largos en vez de ampliarlos.
const BASE_ARGS = ['--output-format', 'stream-json', '--input-format', 'stream-json'] as const;

// Modo de ejecucion. `accept-edits` EXPLICITO para que la sesion sea determinista y coherente con lo que
// la UI advierte ("edita sin preguntar"). Medido en 1.2.14: los tres modos (por defecto, accept-edits,
// plan) escriben sin preguntar y deniegan los comandos; `--mode` solo admite `accept-edits` y `plan`.
// NO se usa `--dangerously-skip-permissions`: no hace falta para escribir dentro de `--add-dir`.
const DEFAULT_MODE = 'accept-edits';
const PLAN_MODE = 'plan';

// `--mode` de agy para el modo de permiso de Mage: `plan` -> plan; cualquier otro (o ninguno) -> accept-edits.
function agyModeArg(permissionMode: string | undefined): string {
  return permissionMode === PLAN_MODE && AGY_PERMISSION_MODES.includes(permissionMode) ? PLAN_MODE : DEFAULT_MODE;
}

// Cuenta de agy por clave de API: su perfil y su clave, resueltos en main (boveda).
export interface AgyApiAccount {
  readonly profileDir: string;
  readonly apiKey: string;
}

export interface AgyAdapterDeps {
  readonly resolveBinary?: () => string;
  // La cuenta de API cuyo perfil es `accountDir`, o null (suscripcion: el login propio de agy).
  readonly resolveApiAccount?: (accountDir: string) => AgyApiAccount | null;
  // La cuenta de SUSCRIPCION registrada cuyo perfil es `accountDir` (login en fichero dentro del perfil), o null.
  readonly resolveSubscriptionAccount?: (accountDir: string) => { readonly profileDir: string } | null;
  // ¿Tiene ese perfil el fichero de token? Sin el, lanzar caeria a la cuenta global de Windows sin avisar.
  readonly hasSubscriptionLogin?: (profileDir: string) => boolean;
  // Perfil de Mage para la suscripcion. Sin el (tests), agy corre con el perfil real del usuario.
  readonly subscriptionProfileDir?: () => string;
  // Prepara el perfil ANTES de lanzar (enlaces y settings.json con las reglas). Lo escribe main: el
  // adapter no toca el disco.
  readonly prepareProfile?: (profileDir: string, cwd: string, mode: AgyProfileMode) => void;
  // Guarda una imagen adjunta y devuelve su ruta absoluta (main la escribe en su carpeta temporal).
  readonly saveAttachment?: (sessionId: string, attachment: ImageAttachment, index: number) => string;
  // Puente de instrucciones (grupo H): deja en una carpeta de Mage, fuera del repo, el GEMINI.md con los
  // CLAUDE.md que agy no tiene como suyos, y devuelve esa carpeta (null = no hay nada que puentear).
  readonly bridgeInstructions?: (sessionId: string, cwd: string, profileDir: string, projectInstructions?: string) => string | null;
}

// Entorno del hijo y el perfil con el que corre (undefined = el real del usuario, solo en tests).
interface ChildLaunch {
  readonly env: NodeJS.ProcessEnv;
  readonly profileDir: string | undefined;
}

export class AgyAdapter implements ProviderAdapter {
  // El login lo hace el propio agy (Mage lo lanza en el perfil de la cuenta y le pasa el codigo que da Google, sin
  // ver el token): `accountLogin` en main. Las cuentas por clave son otra celda de la matriz (providerAccounts.ts).
  readonly launchFlagSettings = true;
  readonly auth: AuthModel = {
    kind: 'external',
    reason: 'agy gestiona su propio login; Mage solo lo lanza en el perfil de cada cuenta y relaya el código',
  };

  private readonly tracker = new AgyTurnTracker();
  private sessionId = '';

  constructor(private readonly deps: AgyAdapterDeps = {}) {}

  buildSpawnPlan(params: LaunchParams): SpawnPlan {
    this.sessionId = params.sessionId;
    this.tracker.resetProcess(); // proceso nuevo: su uso acumulado empieza en cero (medido)
    // `--add-dir <cwd>` es OBLIGATORIO: sin el, `agy` escribe en su propio scratch
    // (~/.gemini/antigravity-cli/scratch/) ignorando el cwd que el mismo reporta en su `init`.
    const args = [...BASE_ARGS, '--mode', agyModeArg(params.permissionMode), '--add-dir', params.cwd, '--model', params.model];
    // Relanzado tras un corte: el id lo genera `agy` (uno arbitrario responde "conversation not found"),
    // asi que solo se pasa el que emitio en su init.
    if (params.conversationId !== undefined && params.conversationId.length > 0) {
      args.push('--conversation', params.conversationId);
    }
    // Nivel de esfuerzo (--effort low|medium|high|max). Lo que no encaje (xhigh es de Claude) se omite
    // en vez de abortar la sesion con un flag invalido.
    if (params.effort !== undefined && AGY_EFFORT_LEVELS.includes(params.effort)) {
      args.push('--effort', params.effort);
    }
    // `params.shared` no se traduce aqui: agy no tiene flag de sesion para MCP (medido en 1.2.14). Lo que
    // Mage comparte con agy se EXPORTA a su mcp_config.json («Sincronizar con agy», mcpAgySync.ts).
    const child = this.childLaunch(params);
    args.push(...this.bridgeArgs(params, child.profileDir));
    return { command: (this.deps.resolveBinary ?? resolveAgyBinary)(), args, env: child.env };
  }

  // Puente de instrucciones, MEDIDO en agy 1.2.16 (`node spike/agy-spike.mjs --instructions`): agy carga
  // como regla el GEMINI.md de cualquier carpeta que reciba con `--add-dir`, aunque este fuera del
  // proyecto. Es POR SESION a proposito: el GEMINI.md global del perfil tambien lo carga, pero lo RELEE
  // EN CADA TURNO (medido) y el perfil de la suscripcion es comun, asi que la pestaña de otro proyecto le
  // cambiaria las instrucciones a esta. Escribir en esa carpeta sigue denegado: solo el cwd tiene
  // `write_file` en el settings.json del perfil.
  private bridgeArgs(params: LaunchParams, profileDir: string | undefined): readonly string[] {
    if (profileDir === undefined || this.deps.bridgeInstructions === undefined) return [];
    const dir = this.deps.bridgeInstructions(params.sessionId, params.cwd, profileDir, params.projectInstructions);
    return dir === null ? [] : ['--add-dir', dir];
  }

  // Env del hijo, SANEADO (scrubAgentEnv borra toda clave heredada, tambien GEMINI_API_KEY). Lleva despues
  // SU perfil: agy resuelve su casa SOLO por `USERPROFILE` (medido), y `HOME` se fija al real para que
  // git siga encontrando su `.gitconfig` (lo resuelve por HOME o HOMEDRIVE+HOMEPATH, medido). Una cuenta
  // por clave lleva ademas SU clave: con perfil propio + `modelProvider: "gemini"` + clave, agy NO cae a
  // la suscripcion (medido con una clave falsa: 400 API_KEY_INVALID).
  // ponytail: solo medido en Windows (la 0.1.2 es solo Windows). En POSIX agy resolvera su casa por HOME,
  // que aqui va al real; se sube midiendolo y fijando HOME al perfil alli.
  private childLaunch(params: LaunchParams): ChildLaunch {
    const env = scrubAgentEnv(process.env);
    const account = this.deps.resolveApiAccount?.(params.accountDir) ?? null;
    const own = account === null ? this.deps.resolveSubscriptionAccount?.(params.accountDir) ?? null : null;
    if (own !== null) return this.subscriptionLaunch(own.profileDir, params, env);
    const profileDir = account?.profileDir ?? this.deps.subscriptionProfileDir?.();
    if (profileDir === undefined) return { env, profileDir };
    this.deps.prepareProfile?.(profileDir, params.cwd, account === null ? 'subscription' : 'api-key');
    const profiled = { ...env, USERPROFILE: profileDir, HOME: homedir() };
    return { env: account === null ? profiled : { ...profiled, GEMINI_API_KEY: account.apiKey }, profileDir };
  }

  // Cuenta de suscripcion con perfil PROPIO: su login vive en un fichero de ese perfil (ver AGY_FILE_TOKEN_ENV).
  private subscriptionLaunch(profileDir: string, params: LaunchParams, env: NodeJS.ProcessEnv): ChildLaunch {
    if (this.deps.hasSubscriptionLogin?.(profileDir) === false) {
      throw new Error(`La cuenta de agy (${profileDir}) no tiene la sesión iniciada: inicia sesión desde «Añadir cuenta» antes de abrir una conversación`);
    }
    this.deps.prepareProfile?.(profileDir, params.cwd, 'subscription');
    return { env: { ...env, USERPROFILE: profileDir, HOME: homedir(), ...AGY_FILE_TOKEN_ENV }, profileDir };
  }

  // `content` solo admite texto (medido): cada imagen se guarda en disco y su ruta va al final del
  // mensaje, junto a su token `[Imagen N]`, para que el agente la abra con `view_file`.
  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = []): unknown {
    if (attachments.length === 0) return { event: 'user', message: { content: text } };
    const save = this.deps.saveAttachment;
    if (save === undefined) {
      throw new Error(`No hay donde guardar las ${attachments.length} imagenes del mensaje para agy`);
    }
    const lines = attachments.map((attachment, index) => `[Imagen ${index + 1}]: ${save(this.sessionId, attachment, index)}`);
    const content = `${text}\n\n${ATTACHMENTS_HEADER}\n${lines.join('\n')}`;
    return { event: 'user', message: { content } };
  }

  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    throw new Error(
      `agy no tiene puente de permisos (no existe --permission-prompt-tool): sus sesiones auto-aprueban. ` +
        `Respuesta descartada: requestId=${ref.requestId} behavior=${decision.behavior}`,
    );
  }

  // Sin interrupcion por stdin (medido en 1.2.14): AgentSession corta matando el arbol de procesos.
  readonly interruptsByKill = true;

  encodeInterrupt(): unknown {
    throw new Error("agy no admite interrupcion por protocolo: el turno se corta matando el proceso");
  }

  // El modelo se fija al lanzar (`--model`); la UI no ofrece cambiarlo en caliente en agy.
  encodeSetModel(model: string): unknown {
    throw new Error(`set_model no aplica a agy: el modelo se fija al lanzar (--model). Pedido: ${JSON.stringify(model)}`);
  }

  encodeSetPermissionMode(mode: string): unknown {
    throw new Error(`set_permission_mode no aplica a agy: no tiene control de permisos que cambiar. Pedido: ${JSON.stringify(mode)}`);
  }

  normalize(raw: unknown): MageEvent[] {
    return this.tracker.normalize(raw);
  }
}

// Texto que precede a las rutas de las imagenes (para el modelo, no para el usuario).
const ATTACHMENTS_HEADER = 'Imágenes adjuntas (ábrelas con la herramienta view_file):';
