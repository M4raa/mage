import { buildHandoffPrompt, buildImprovePrompt } from './promptText';
import { scrubAgentEnv } from '../os/agentEnv';

// Modelo barato para la mejora de prompt (no gastar Opus en reescribir un borrador). Alias del CLI.
const CHEAP_MODEL = 'haiku';

// Dependencias inyectables -> testable sin spawnear el CLI real.
export interface PromptServiceDeps {
  readonly resolveBinary: () => string;
  // Ejecuta el CLI y resuelve con su stdout (rechaza si el proceso falla). En produccion: execFile.
  // `cwd` es el directorio de trabajo del hijo: para `--resume` es OBLIGATORIO que sea el de la
  // conversacion (el CLI busca la sesion bajo projects/<cwd-codificado>).
  readonly run: (
    command: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd?: string,
  ) => Promise<string>;
}

// Parametros del handoff. Objeto de contexto (y no 4 argumentos sueltos) por el estandar del proyecto.
export interface HandoffRequest {
  readonly sessionId: string;
  // Config dir EFECTIVO de la conversacion: la cuenta, o su perfil privado si es privada. Con el de la
  // cuenta, una conversacion privada no se encuentra (su transcripcion vive en mage-private).
  readonly accountDir: string;
  readonly model: string;
  // cwd de la conversacion: el CLI resuelve `--resume <id>` dentro de projects/<cwd-codificado>.
  readonly cwd: string;
}

// Mejora un borrador de prompt con un `claude -p` puntual (una sola respuesta, sin sesion persistente
// ni streaming). Consume la suscripcion de la cuenta indicada (CLAUDE_CONFIG_DIR) y mantiene la
// invariante de facturacion: ANTHROPIC_API_KEY fuera del hijo.
export class PromptService {
  constructor(private readonly deps: PromptServiceDeps) {}

  async improve(draft: string, accountDir: string): Promise<string> {
    const prompt = buildImprovePrompt(draft); // valida draft no vacio en la frontera
    if (accountDir.trim().length === 0) {
      throw new Error(`accountDir vacio para mejorar el prompt: ${JSON.stringify(accountDir)}`);
    }
    const env: NodeJS.ProcessEnv = { ...scrubAgentEnv(process.env), CLAUDE_CONFIG_DIR: accountDir };
    const args = ['-p', prompt, '--model', CHEAP_MODEL, '--output-format', 'text'];

    const stdout = await this.deps.run(this.deps.resolveBinary(), args, env);
    const improved = stdout.trim();
    if (improved.length === 0) throw new Error('La mejora de prompt devolvio una respuesta vacia');
    return improved;
  }

  // Genera un prompt de handoff autocontenido reanudando la sesion (`claude --resume <id> -p ...`):
  // el modelo ya tiene el contexto de la conversacion, asi que resume objetivo/decisiones/estado/
  // proximos pasos. NOTA: al reanudar, esto anade un turno a la transcripcion de la sesion.
  // El hijo se lanza EN EL cwd de la conversacion: `--resume` resuelve el id dentro de
  // projects/<cwd-codificado>, asi que lanzarlo desde otro sitio da "No conversation found".
  async handoff({ sessionId, accountDir, model, cwd }: HandoffRequest): Promise<string> {
    if (sessionId.trim().length === 0) throw new Error(`sessionId vacio para el handoff: ${JSON.stringify(sessionId)}`);
    if (accountDir.trim().length === 0) throw new Error(`accountDir vacio para el handoff: ${JSON.stringify(accountDir)}`);
    if (cwd.trim().length === 0) throw new Error(`cwd vacio para el handoff: ${JSON.stringify(cwd)}`);
    const env: NodeJS.ProcessEnv = { ...scrubAgentEnv(process.env), CLAUDE_CONFIG_DIR: accountDir };
    const args = ['--resume', sessionId, '-p', buildHandoffPrompt(), '--output-format', 'text'];
    if (model.trim().length > 0) args.push('--model', model.trim());

    const stdout = await this.deps.run(this.deps.resolveBinary(), args, env, cwd);
    const handoff = stdout.trim();
    if (handoff.length === 0) throw new Error('El handoff devolvio una respuesta vacia');
    return handoff;
  }
}
