import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { resolveAgyBinary } from '../os/agyBinaryResolver';
import { normalizeAgyEvent } from './agyNormalize';
import type { AuthModel, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan, TurnMode } from './providerAdapter';
import { scrubAgentEnv } from '../os/agentEnv';

// Adapter del CLI de Antigravity (`agy`) como motor NATIVO (E3). Consume la SUSCRIPCION de Google con
// el login OAuth propio de `agy` (no hay `GEMINI_API_KEY` de por medio: eso facturaria la API y
// contradiria el invariante nº 1 del proyecto).
//
// Es el primer adapter en modo 'perTurn': `agy` NO tiene `--input-format` (medido con el oraculo de
// flags: `flags provided but not defined`), asi que no hay protocolo por stdin. El prompt va en argv
// (`--print <prompt>`) y el proceso MUERE al cerrar el turno. Ver providerAdapter.ts (TurnMode) y
// agentSession.ts para lo que eso implica en el ciclo de vida.
//
// Todo lo de aqui esta MEDIDO contra `agy` 1.1.11 el 2026-08-11 (informe de E3); el CLI se
// auto-actualiza cada pocos dias, asi que `node spike/agy-spike.mjs` re-mide sin gastar peticiones.
//
// ponytail: TECHO DE v1, deliberado. Una pestana de `agy` conversa multi-turno mientras Mage esta
// abierto (el conversation_id vive en memoria, en la AgentSession), con su uso real y sus tool calls.
// Fuera de v1, con el camino para subirlo:
//   - Persistir el conversation_id entre reinicios de Mage: se sube guardandolo en la Tab del
//     workspace-state.json y pasandolo como `conversationId` al crear la sesion.
//   - Reconstruir el hilo al reabrir la pestana: `agy` no escribe en ~/.claude/projects, pero deja un
//     fichero por conversacion en ~/.gemini/antigravity-cli/conversations (.db/.pb, formato propio);
//     se sube traduciendolo al modelo de transcripcion de Mage.
//   - Permisos REALES: bloqueados en el CLI (no hay --permission-prompt-tool). Se sube el dia que
//     `agy` lo estrene: entonces esta pestana pasaria por los dialogos de Mage y sobraria el aviso.
//   - Multicuenta: `agy` tiene un unico login propio; el `accountDir` de Mage no le aplica.

// Argumentos fijos de cada turno.
//  - `--output-format stream-json`: NDJSON por stdout (init/step_update/result). NO exige `--verbose`
//    (ese flag no existe en `agy`), a diferencia del CLI de Claude.
//  - `--print <prompt>`: el prompt entero por argv; es el unico canal de entrada que hay.
const BASE_ARGS = ['--output-format', 'stream-json'] as const;

// Modo de ejecucion. `accept-edits` EXPLICITO a proposito: con el modo por defecto
// (`request-review`) el comportamiento observado ha cambiado entre versiones —en 1.1.2 una tool que
// necesitaba permiso acababa en `state: ERROR`, y en 1.1.11 la escritura simplemente se aplica sin
// preguntar— y en ninguno de los dos casos Mage puede intervenir. Declararlo hace la sesion
// DETERMINISTA y coherente con lo que la UI advierte ("edita sin preguntar").
// NO se usa `--dangerously-skip-permissions`: no hace falta para escribir dentro de `--add-dir`.
// ponytail: no hay permisos reales porque el CLI no ofrece puente (no existe
// `--permission-prompt-tool`, medido). Techo: esta pestana no pasa por los dialogos de permiso de
// Mage; se sube el dia que `agy` estrene un puente, sustituyendo este flag por el modo por defecto.
const MODE_ARGS = ['--mode', 'accept-edits'] as const;

// Tope de espera del turno. `agy` mata el suyo a los 5m por defecto; un turno de agente puede pasar de
// ahi con facilidad, y el corte llega como un proceso muerto SIN `result`, que es justo el caso que
// AgentSession tiene que reportar como fallo. Se sube a 30m para que el tope real sea el del usuario.
const PRINT_TIMEOUT = '30m';

export class AgyAdapter implements ProviderAdapter {
  // `agy` mantiene su propia sesion OAuth fuera de Mage (por eso su buildSpawnPlan NO fija ningun
  // config dir de cuenta). No hay alta que ofrecer: la UI no debe pintar un boton que no hace nada.
  readonly auth: AuthModel = {
    kind: 'external',
    reason: 'agy gestiona su propio login OAuth; Mage no crea ni cambia sus cuentas',
  };

  readonly turnMode: TurnMode = 'perTurn';

  // Resolver inyectable para testear el plan de spawn sin tocar el FS.
  constructor(private readonly resolveBinary: () => string = resolveAgyBinary) {}

  // En 'perTurn' no hay nada que arrancar antes del primer mensaje: sin prompt no hay proceso.
  buildSpawnPlan(params: LaunchParams): SpawnPlan {
    throw new Error(
      `agy no admite una sesion persistente (no tiene --input-format): cada turno es un proceso. ` +
        `Sesion pedida: ${JSON.stringify(params.sessionId)}`,
    );
  }

  buildTurnSpawnPlan(params: LaunchParams, prompt: string): SpawnPlan {
    if (prompt.trim().length === 0) {
      throw new Error(`Prompt vacio para un turno de agy: ${JSON.stringify(prompt)}`);
    }
    // `--add-dir <cwd>` es OBLIGATORIO: sin el, `agy` escribe en su propio scratch
    // (~/.gemini/antigravity-cli/scratch/) ignorando el cwd que el mismo reporta en su `init`.
    const args = [
      ...BASE_ARGS,
      ...MODE_ARGS,
      '--add-dir',
      params.cwd,
      '--model',
      params.model,
      '--print-timeout',
      PRINT_TIMEOUT,
    ];
    // Continuar la conversacion: el id lo genera `agy` (uno arbitrario responde "conversation not
    // found" y arranca otra), asi que solo se pasa desde el segundo turno, con el capturado en el init.
    if (params.conversationId !== undefined && params.conversationId.length > 0) {
      args.push('--conversation', params.conversationId);
    }
    // Nivel de esfuerzo opcional (--effort low|medium|high). Los niveles de Mage incluyen xhigh/max,
    // que `agy` no acepta: lo que no encaje se omite en vez de abortar el turno con un flag invalido.
    if (params.effort !== undefined && AGY_EFFORT_LEVELS.includes(params.effort)) {
      args.push('--effort', params.effort);
    }
    args.push('--print', prompt);

    // Env del hijo: `agy` usa su propio login OAuth (no el CLAUDE_CONFIG_DIR de la cuenta de Mage, que
    // aqui no aplica). Se BORRAN las api keys de pago que pudiera haber en el entorno del usuario:
    // invariante nº 1 (suscripcion, nunca API facturada) y ninguna key entra en el proceso hijo.
    const env: NodeJS.ProcessEnv = scrubAgentEnv(process.env);
    return { command: this.resolveBinary(), args, env };
  }

  // --- Lo que `agy` NO soporta ---------------------------------------------------------------------
  // Mismo patron que GatewayAdapter: metodo presente por contrato que LANZA explicando por que, o
  // metodo opcional simplemente ausente (encodeGetContextUsage/encodeInitialize/encodeHookResponse:
  // `agy` no tiene control_request, hooks, --mcp-config ni --settings).

  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = []): unknown {
    throw new Error(
      `agy no lee mensajes por stdin (no tiene --input-format): el prompt va en argv, y tampoco admite ` +
        `imagenes adjuntas (${attachments.length} descartadas). ` +
        `Texto recibido: ${JSON.stringify(text.slice(0, TEXT_IN_ERROR_MAX))}`,
    );
  }

  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    throw new Error(
      `agy no tiene puente de permisos (no existe --permission-prompt-tool): sus sesiones auto-aprueban. ` +
        `Respuesta descartada: requestId=${ref.requestId} behavior=${decision.behavior}`,
    );
  }

  // Interrumpir un turno de `agy` es matar su proceso, no mandarle un mensaje: lo hace AgentSession en
  // modo perTurn sin pasar por aqui.
  encodeInterrupt(): unknown {
    throw new Error('agy no admite interrupcion por protocolo: el turno se corta matando el proceso');
  }

  // Cambiar de modelo en `agy` es gratis y no necesita peticion: el turno SIGUIENTE se lanza con otro
  // `--model`. AgentSession lo resuelve asi en modo perTurn y no llega a llamar aqui.
  encodeSetModel(model: string): unknown {
    throw new Error(
      `set_model no aplica a agy: el modelo se fija al lanzar cada turno (--model). Pedido: ${JSON.stringify(model)}`,
    );
  }

  encodeSetPermissionMode(mode: string): unknown {
    throw new Error(
      `set_permission_mode no aplica a agy: no tiene control de permisos que cambiar. Pedido: ${JSON.stringify(mode)}`,
    );
  }

  normalize(raw: unknown): MageEvent[] {
    return normalizeAgyEvent(raw);
  }
}

// Niveles que acepta `--effort` de `agy` (documentados en su --help: low|medium|high). Los de Mage
// (EFFORT_LEVELS) traen ademas xhigh/max, que son del CLI de Claude.
const AGY_EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high'];

// Cuanto prompt se cita en un mensaje de error (el contrato de errores pide incluir el valor recibido,
// pero un prompt entero en un Error no ayuda a nadie).
const TEXT_IN_ERROR_MAX = 60;
