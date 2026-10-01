import type { LoopTools, PreparedInput, ToolOutcome } from '../agentLoop';
import type { ChatToolSpec } from '../chatClient';
import { fail, toJsonSchema, type RuntimeTool, type ToolContext } from './types';

// Catalogo de herramientas de una sesion: genera los `tools` de la peticion, valida los argumentos que
// manda el modelo (los errores vuelven AL MODELO para que se corrija, no rompen el turno) y ejecuta.
// Inyectable: una herramienta nueva (MCP, `Delegate` de P-031) se registra sin tocar el bucle.

const RAW_ARGS_IN_ERROR_MAX = 200;

export class ToolRegistry implements LoopTools {
  private readonly byName: Map<string, RuntimeTool>;

  constructor(
    tools: readonly RuntimeTool[],
    private readonly context: (signal: AbortSignal) => ToolContext,
  ) {
    const byName = new Map<string, RuntimeTool>();
    for (const tool of tools) {
      if (byName.has(tool.name)) throw new Error(`Herramienta registrada dos veces: ${tool.name}`);
      byName.set(tool.name, tool);
    }
    this.byName = byName;
  }

  // Herramientas que llegan despues de crear la sesion (las de los servidores MCP, al conectar). Un
  // nombre repetido se descarta con su motivo: nunca pisa a una herramienta propia.
  add(tools: readonly RuntimeTool[]): readonly string[] {
    const skipped: string[] = [];
    for (const tool of tools) {
      if (this.byName.has(tool.name)) skipped.push(tool.name);
      else this.byName.set(tool.name, tool);
    }
    return skipped;
  }

  names(): readonly string[] {
    return [...this.byName.keys()];
  }

  get(name: string): RuntimeTool | undefined {
    return this.byName.get(name);
  }

  specs(): readonly ChatToolSpec[] {
    return [...this.byName.values()].map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.jsonSchema ?? toJsonSchema(tool.fields) },
    }));
  }

  prepare(name: string, argumentsJson: string): PreparedInput {
    const tool = this.byName.get(name);
    if (tool === undefined) return this.unknown(name);
    // Una llamada sin argumentos llega como '' en algunos servidores.
    const text = argumentsJson.trim().length === 0 ? '{}' : argumentsJson;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `Error: los argumentos de ${name} no son JSON válido (${(err as Error).message}). Recibido: ${clip(argumentsJson)}` };
    }
    return this.validate(tool, parsed);
  }

  prepareInput(name: string, input: unknown): PreparedInput {
    const tool = this.byName.get(name);
    return tool === undefined ? this.unknown(name) : this.validate(tool, input);
  }

  async run(name: string, input: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ToolOutcome> {
    const tool = this.byName.get(name);
    if (tool === undefined) return fail(this.unknownMessage(name));
    try {
      return await tool.run(input, this.context(signal));
    } catch (err) {
      // El fallo de una herramienta es un resultado para el modelo, no el fin del turno.
      return fail(`Error ejecutando ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private validate(tool: RuntimeTool, raw: unknown): PreparedInput {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `Error: los argumentos de ${tool.name} tienen que ser un objeto JSON. Recibido: ${clip(JSON.stringify(raw))}` };
    }
    const result = tool.input.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`).join('; ');
      return { ok: false, error: `Error: argumentos inválidos para ${tool.name}: ${issues}` };
    }
    return { ok: true, kind: tool.kind, input: result.data };
  }

  private unknown(name: string): PreparedInput {
    return { ok: false, error: this.unknownMessage(name) };
  }

  private unknownMessage(name: string): string {
    return `Error: la herramienta ${JSON.stringify(name)} no existe. Disponibles: ${this.names().join(', ') || 'ninguna'}`;
  }
}

function clip(text: string): string {
  return text.length > RAW_ARGS_IN_ERROR_MAX ? `${text.slice(0, RAW_ARGS_IN_ERROR_MAX)}…` : text;
}
