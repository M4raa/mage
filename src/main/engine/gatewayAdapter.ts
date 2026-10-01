import { randomUUID } from 'node:crypto';
import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { resolveClaudeBinary } from '../os/claudeBinaryResolver';
import { normalizeRawEvent } from './normalize';
import type { AuthModel, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan } from './providerAdapter';
import { getGatewayPort, registerSession } from './proxy/gateway';
import { scrubAgentEnv } from '../os/agentEnv';
import { claudeSharedLaunch, refuseClaudeMcpConfig, type ClaudeMcpConfigWriter } from '../config/mcpProviderTranslate';

// Adapter UNICO de todos los proveedores que no son Claude (E2). El motor sigue siendo el CLI real de
// Claude Code: lo que cambia es que `ANTHROPIC_BASE_URL` apunta al gateway local, que traduce
// Anthropic<->OpenAI y decide el upstream por el id de proveedor de la sesion. Sustituye a los cuatro
// adapters gemelos (openai/gemini/ollama/lmstudio) que solo se diferenciaban en ese id, y es lo que
// permite que un proveedor anadido por el usuario funcione SIN codigo nuevo.
// `ClaudeAdapter` sigue aparte: es el nativo y no pasa por el gateway.

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

export class GatewayAdapter implements ProviderAdapter {
  // La credencial del proveedor vive en el main (entorno o app-settings.json) y NUNCA entra en el
  // entorno del hijo: al CLI se le da un ticket `sk-mage-<sessionId>` que el gateway canjea al
  // reenviar. Por eso el alta de este proveedor es "pegar una key", no un login.
  readonly auth: AuthModel = {
    kind: 'api-key',
    keyLabel: 'API key del proveedor, guardada en el proceso main (el hijo solo recibe un ticket sk-mage-<id>)',
  };

  constructor(
    private readonly providerId: string,
    private readonly resolveBinary: () => string = resolveClaudeBinary,
    // Inyectado como el resolutor de binario (y por lo mismo): el plan de arranque se puede probar sin
    // levantar un servidor de verdad. Por defecto, el puerto del gateway real.
    private readonly getPort: () => number = getGatewayPort,
    // Como en ClaudeAdapter: debajo corre el mismo CLI y recibe el mismo `--mcp-config` de la cuenta.
    private readonly writeMcpConfig: ClaudeMcpConfigWriter = refuseClaudeMcpConfig,
  ) {
    if (providerId.trim().length === 0) {
      throw new Error(`GatewayAdapter necesita un id de proveedor (recibido: ${JSON.stringify(providerId)})`);
    }
  }

  buildSpawnPlan(params: LaunchParams): SpawnPlan {
    registerSession(params.sessionId, {
      provider: this.providerId,
      model: params.model,
      accountDir: params.accountDir,
    });

    const port = this.getPort();
    // Guard clause (contrato de error): sin gateway vivo el puerto es 0, y lanzar el CLI contra
    // `127.0.0.1:0` le hace fallar con un error de red que no dice nada de la causa real.
    if (port === 0) {
      throw new Error(`El gateway local no esta activo: no se puede lanzar una sesion de ${this.providerId}`);
    }
    // Mismo criterio que `claudeAdapter`: reanudar es `--resume <id>`. Debajo corre el mismo CLI, que
    // RECHAZA un `--session-id` ya usado, asi que un reinicio (C1) con `--session-id` moria siempre.
    const sessionArgs = params.resume === true ? ['--resume', params.sessionId] : ['--session-id', params.sessionId];
    // Lo comun, traducido igual que en el nativo (es el mismo CLI).
    const shared = claudeSharedLaunch(params.shared, params.accountDir, this.writeMcpConfig);
    const args = [...BASE_ARGS, ...sessionArgs, '--model', params.model, ...shared.args];

    // La api key del hijo es el TICKET de la sesion (sk-mage-<sessionId>), no la credencial del
    // proveedor: esa vive solo en el main (entorno o app-settings.json) y el gateway la pone al
    // reenviar. Asi ninguna key de proveedor entra en el entorno del CLI.
    const env: NodeJS.ProcessEnv = {
      // Saneado ANTES de poner las suyas: las dos de abajo son a proposito (ver agentEnv.ts).
      ...scrubAgentEnv(process.env),
      CLAUDE_CONFIG_DIR: params.accountDir,
      ...shared.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/v1`,
      ANTHROPIC_API_KEY: `sk-mage-${params.sessionId}`,
    };
    return { command: this.resolveBinary(), args, env };
  }

  // Este proveedor va por el gateway, que traduce a la API de OpenAI: esa ruta NO esta medida con
  // imagenes, asi que se rechaza en vez de mandar algo que no sabemos si el otro lado entiende.
  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = []): unknown {
    if (attachments.length > 0) {
      throw new Error(`Este proveedor no admite imagenes adjuntas todavia (se intentaron enviar ${attachments.length})`);
    }
    return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
  }

  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    const payload =
      decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: {}, toolUseID: ref.toolUseId }
        : { behavior: 'deny', message: decision.message, toolUseID: ref.toolUseId };
    return {
      type: 'control_response',
      response: { subtype: 'success', request_id: ref.requestId, response: payload },
    };
  }

  encodeInterrupt(): unknown {
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } };
  }

  // El cambio de modelo en caliente es especifico del CLI de Claude; aqui no aplica (la UI solo lo
  // ofrece para Claude, este metodo existe por contrato de la interfaz).
  encodeSetModel(model: string): unknown {
    throw new Error(`set_model no soportado por ${this.providerId} (modelo pedido: ${JSON.stringify(model)})`);
  }

  encodeSetPermissionMode(mode: string): unknown {
    throw new Error(
      `set_permission_mode no soportado por ${this.providerId} (modo pedido: ${JSON.stringify(mode)})`,
    );
  }

  normalize(raw: unknown): MageEvent[] {
    return normalizeRawEvent(raw);
  }
}
