import { isToolAllowed, type ToolAccessRule } from '@shared/toolAccess';
import type { LoopTools, PreparedInput, ToolOutcome } from '../agentLoop';
import type { ChatToolSpec } from '../chatClient';
import type { ToolRegistry } from './registry';

// El registro de la sesion visto por el modelo que la usa AHORA (§8.1 D10): las herramientas que su
// regla de acceso no permite no se anuncian y, si el modelo las llama igual, se le dice por que.
// Las reglas y el modelo se leen en cada uso: cambiar de modelo o editar Ajustes aplica al siguiente turno.
export class AccessFilteredTools implements LoopTools {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly rules: () => readonly ToolAccessRule[],
    private readonly model: () => string,
  ) {}

  names(): readonly string[] {
    return this.registry.names().filter((name) => this.allowed(name));
  }

  specs(): readonly ChatToolSpec[] {
    return this.registry.specs().filter((spec) => this.allowed(spec.function.name));
  }

  prepare(name: string, argumentsJson: string): PreparedInput {
    return this.allowed(name) ? this.registry.prepare(name, argumentsJson) : this.refuse(name);
  }

  prepareInput(name: string, input: unknown): PreparedInput {
    return this.allowed(name) ? this.registry.prepareInput(name, input) : this.refuse(name);
  }

  run(name: string, input: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ToolOutcome> {
    if (!this.allowed(name)) return Promise.resolve({ isError: true, output: refusal(name, this.model()) });
    return this.registry.run(name, input, signal);
  }

  private allowed(name: string): boolean {
    return isToolAllowed(this.rules(), this.model(), name);
  }

  private refuse(name: string): PreparedInput {
    return { ok: false, error: refusal(name, this.model()) };
  }
}

function refusal(name: string, model: string): string {
  return `Error: la herramienta ${JSON.stringify(name)} no está permitida para el modelo ${model} (Ajustes › Proveedores).`;
}
