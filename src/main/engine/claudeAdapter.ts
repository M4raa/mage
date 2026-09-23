import { randomUUID } from 'node:crypto';
import type { ImageAttachment } from '@shared/ipc';
import { base64ByteLength, validateAttachment } from '@shared/attachments';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { resolveClaudeBinary } from '../os/claudeBinaryResolver';
import { normalizeRawEvent } from './normalize';
import type { AuthModel, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan } from './providerAdapter';
import { scrubAgentEnv } from '../os/agentEnv';

// Argumentos fijos del CLI headless stream-json (confirmados en el spike M1.0).
// --output-format stream-json EXIGE --verbose. --permission-prompt-tool stdio activa el
// round-trip de permisos por stdin/stdout.
const BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-prompt-tool',
  'stdio',
  '--include-partial-messages',
] as const;

// Hooks que Mage registra al arrancar (D2). Todos son de OBSERVACION del ciclo de vida: dan
// seguimiento fiable de lo que hace la sesion sin deducirlo del texto del modelo. Nombres del
// protocolo (HOOK_EVENTS del CLI). Deliberadamente FUERA: PreToolUse/PostToolUse (ruta critica de cada
// tool, ya cubierta por tool_use/tool_result del stream) y todo lo que pueda alterar decisiones.
const OBSERVED_HOOK_EVENTS = [
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
] as const;

// Un solo callback id: el evento ya viene identificado en `input.hook_event_name`, asi que no hace
// falta un id por evento para saber quien disparo.
const HOOK_CALLBACK_ID = 'mage-observer';

// Tope que el CLI espera nuestra respuesta antes de seguir por su cuenta. Corto a proposito: un hook
// de observacion nunca debe retrasar una conversacion.
const HOOK_TIMEOUT_SECONDS = 5;

// Adapter de Claude: unica implementacion de ProviderAdapter en el MVP. Conoce el comando, sus
// flags, el NDJSON de entrada y el protocolo de permisos; nada de esto escapa de aqui.
export class ClaudeAdapter implements ProviderAdapter {
  // El login lo hace el propio CLI (Fase 9): Mage orquesta `claude auth login` y NUNCA ve el token.
  // `loginArgs` esta MEDIDO contra el binario 2.1.270 (`spike/cli-login-spike.mjs`), no leido del
  // `--help`. El layout es el que usaba AccountService cableado por dentro hasta 9.1.
  readonly auth: AuthModel = {
    kind: 'cli-oauth',
    login: {
      accounts: {
        configDirEnvVar: 'CLAUDE_CONFIG_DIR',
        mainDirName: '.claude',
        stateFileName: '.claude.json',
      },
      loginArgs: ['auth', 'login', '--claudeai'],
    },
  };

  // Resolver inyectable para testear el plan de spawn sin tocar el FS.
  constructor(private readonly resolveBinary: () => string = resolveClaudeBinary) {}

  buildSpawnPlan(params: LaunchParams): SpawnPlan {
    // Reanudar (`--resume <id>`) continua la conversacion existente y sigue escribiendo en su misma
    // transcripcion; arrancar (`--session-id <id>`) crea una nueva con el id dado. Mutuamente
    // excluyentes: el CLI no acepta ambos.
    const sessionArgs = params.resume === true ? ['--resume', params.sessionId] : ['--session-id', params.sessionId];
    const args = [...BASE_ARGS, ...sessionArgs, '--model', params.model];
    // Effort opcional (M2.4): solo se anade si viene (ya validado en la frontera); sin el, default CLI.
    if (params.effort !== undefined && params.effort.length > 0) args.push('--effort', params.effort);
    // Tope de gasto opcional (M2.4): centavos enteros -> dolares con 2 decimales SOLO en la frontera
    // del argumento del CLI (internamente el dinero nunca es float). Ya validado (>0) aguas arriba.
    if (params.maxBudgetUsdCents !== undefined) args.push('--max-budget-usd', centsToUsd(params.maxBudgetUsdCents));
    // Modo de permiso inicial opcional (M2.6): --permission-mode <mode>. Solo se anade si NO es el
    // default (evita ruido). Confirmado contra el fuente del CLI (initialPermissionModeFromCLI).
    if (params.permissionMode !== undefined && params.permissionMode.length > 0 && params.permissionMode !== 'default') {
      args.push('--permission-mode', params.permissionMode);
    }
    // Config comun (D1 Fase 1): --mcp-config/--settings ya resueltos por SharedConfigService.
    args.push(...(params.sharedConfigArgs ?? []));
    // Env del hijo: se fija la cuenta y se SANEA (scrubAgentEnv). El invariante de facturacion vive
    // ahora en un solo sitio: ver src/main/os/agentEnv.ts.
    const env: NodeJS.ProcessEnv = { ...scrubAgentEnv(process.env), CLAUDE_CONFIG_DIR: params.accountDir };
    return { command: this.resolveBinary(), args, env };
  }

  // SIN adjuntos, el payload es EXACTAMENTE el de siempre (`content` string), que es la forma minima
  // viable validada en el spike. Con adjuntos pasa a array de bloques, que es como el protocolo lleva
  // imagenes: [{type:'text'}, {type:'image', source:{type:'base64', media_type, data}}].
  // `parent_tool_use_id`: clave requerida, nullable.
  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = []): unknown {
    if (attachments.length === 0) {
      return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    }
    // Segunda validacion, la de verdad: esto es lo que llega por IPC. `data.length` NO es el tamaño
    // (base64 abulta ~4/3), asi que se decodifica el tamaño real.
    for (const attachment of attachments) {
      validateAttachment({ mediaType: attachment.mediaType, byteLength: base64ByteLength(attachment.data) });
    }
    const content = [
      // Un mensaje de SOLO imagen es valido: entonces no se manda un bloque de texto vacio.
      ...(text.length === 0 ? [] : [{ type: 'text', text }]),
      ...attachments.map((attachment) => ({
        type: 'image',
        source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data },
      })),
    ];
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }

  // `updatedInput` REESCRIBE el input de la tool: por ahi viajan las respuestas de AskUserQuestion
  // (2.3). Sin el, `{}` — que NO es un bug: el fuente del CLI dice que significa "usa el input
  // original" y es lo que mandan sus clientes moviles. El campo del payload es `toolUseID`, con la D y
  // la ID en mayusculas; escribirlo `toolUseId` compila igual y el CLI no lo reconoce.
  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    const payload =
      decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: decision.updatedInput ?? {}, toolUseID: ref.toolUseId }
        : { behavior: 'deny', message: decision.message, toolUseID: ref.toolUseId };
    return {
      type: 'control_response',
      response: { subtype: 'success', request_id: ref.requestId, response: payload },
    };
  }

  encodeInterrupt(): unknown {
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } };
  }

  // Cambio de modelo en caliente (protocolo confirmado contra el fuente del CLI 2.1.214): el CLI
  // responde control_response success y el nuevo modelo aplica al SIGUIENTE turno.
  encodeSetModel(model: string): unknown {
    if (model.trim().length === 0) throw new Error(`Modelo vacio para set_model: ${JSON.stringify(model)}`);
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'set_model', model } };
  }

  // Cambio de modo de permiso en caliente (protocolo confirmado contra el fuente del CLI): el CLI
  // responde control_response success {mode} y emite system/status con el nuevo permissionMode.
  encodeSetPermissionMode(mode: string): unknown {
    if (mode.trim().length === 0) throw new Error(`Modo de permiso vacio para set_permission_mode: ${JSON.stringify(mode)}`);
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'set_permission_mode', mode } };
  }

  // Desglose de la ventana de contexto (D3). Protocolo verificado EN VIVO contra el CLI 2.1.220: el
  // request no lleva campos y el CLI contesta control_response success con {categories, totalTokens,
  // maxTokens, percentage, ...}. Se puede pedir sin haber mandado ningun turno (no gasta suscripcion).
  encodeGetContextUsage(): unknown {
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'get_context_usage' } };
  }

  // Registro de hooks al arrancar (D2). Verificado EN VIVO contra el CLI 2.1.220: el CLI responde
  // success (con el catalogo de comandos, ver normalize) y a partir de ahi manda un control_request
  // hook_callback por cada disparo. Detalles del diseno:
  //  - Solo hooks de OBSERVACION (ciclo de vida). No se registran PreToolUse/PostToolUse: van en la
  //    ruta critica de cada tool y el stream ya da tool_use/tool_result, asi que solo anadirian
  //    latencia y riesgo de bloquear la conversacion si algo va mal en la respuesta.
  //  - `timeout` explicito por matcher: si Mage no contestara, el CLI espera ESE tiempo y sigue, en
  //    vez de quedarse colgado indefinidamente.
  encodeInitialize(): unknown {
    const matchers = OBSERVED_HOOK_EVENTS.map(() => [
      { hookCallbackIds: [HOOK_CALLBACK_ID], timeout: HOOK_TIMEOUT_SECONDS },
    ]);
    const hooks = Object.fromEntries(OBSERVED_HOOK_EVENTS.map((event, index) => [event, matchers[index]]));
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'initialize', hooks } };
  }

  // Respuesta a un hook_callback: `continue: true` = solo observamos, no alteramos el flujo (no se
  // deniega, ni se reescribe input, ni se corta el turno).
  encodeHookResponse(requestId: string): unknown {
    if (requestId.trim().length === 0) {
      throw new Error(`requestId vacio al responder a un hook: ${JSON.stringify(requestId)}`);
    }
    return {
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: { continue: true } },
    };
  }

  normalize(raw: unknown): MageEvent[] {
    return normalizeRawEvent(raw);
  }
}

// Formatea centavos enteros como dolares con 2 decimales (p.ej. 500 -> "5.00"), solo para el arg del
// CLI. La division entera + resto evita el error de coma flotante de (cents/100).toFixed(2).
function centsToUsd(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}
