import type { z } from 'zod';
import type { ToolKind, ToolOutcome } from '../agentLoop';

// Contrato de una herramienta del runtime propio. Se llaman como las del CLI de Claude y aceptan sus
// mismos campos (`file_path`, `old_string`…): asi el renderer las pinta igual (iconos, diff, historial).

export interface ToolContext {
  readonly cwd: string;
  // Directorios añadidos a la sesion ademas del cwd (fuera de ellos, toda ruta pregunta).
  readonly extraDirs: readonly string[];
  readonly signal: AbortSignal;
}

// Campo plano de la entrada: lo unico que necesitan las seis herramientas. El JSON Schema que se manda
// al modelo se genera de esta descripcion (`toJsonSchema`), sin dependencia `zod-to-json-schema`.
export interface FieldSpec {
  readonly type: 'string' | 'number' | 'boolean';
  readonly description: string;
  readonly required: boolean;
  readonly enum?: readonly string[];
}

export interface RuntimeTool<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly kind: ToolKind;
  readonly description: string;
  readonly fields: Readonly<Record<string, FieldSpec>>;
  // Esquema JSON ya hecho (las herramientas MCP traen el suyo); ausente = se genera de `fields`.
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
  readonly input: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  run(input: TInput, ctx: ToolContext): Promise<ToolOutcome>;
}

export function toJsonSchema(fields: Readonly<Record<string, FieldSpec>>): Record<string, unknown> {
  const properties = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      { type: field.type, description: field.description, ...(field.enum === undefined ? {} : { enum: field.enum }) },
    ]),
  );
  const required = Object.entries(fields)
    .filter(([, field]) => field.required)
    .map(([name]) => name);
  return { type: 'object', properties, required, additionalProperties: false };
}

// Salida hacia el modelo: cabeza y cola con una marca en medio. Critico para ventanas de 4k.
export const TOOL_OUTPUT_MAX_CHARS = 8_000;

export function truncateOutput(text: string, maxChars: number = TOOL_OUTPUT_MAX_CHARS): string {
  if (maxChars <= 0) throw new Error(`Tope de salida invalido: ${maxChars}`);
  if (text.length <= maxChars) return text;
  const head = Math.ceil(maxChars * 0.6);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[… ${omitted} caracteres omitidos …]\n${text.slice(text.length - tail)}`;
}

export function ok(output: string): ToolOutcome {
  return { isError: false, output: truncateOutput(output) };
}

export function fail(output: string): ToolOutcome {
  return { isError: true, output: truncateOutput(output) };
}
