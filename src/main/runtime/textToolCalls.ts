// Llamadas a herramientas que un modelo ESCRIBE en su texto en vez de hacerlas por la API (§8.1 D7 de
// P-032: Mage las interpreta en la 0.1.2). Formatos medidos o documentados:
//   - `<tool_call>{"name": …, "arguments": {…}}</tool_call>`  (plantillas de Qwen/Hermes; el spike lo mide)
//   - `[TOOL_REQUEST]{…}[END_TOOL_REQUEST]`                    (LM Studio cuando no sabe parsearla)
//   - un bloque ```json con `{"name": …, "arguments"|"parameters": {…}}` (modelos sin plantilla)
// PURO.

export interface TextToolCall {
  readonly name: string;
  readonly argumentsJson: string;
}

const TAGGED = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
const LMSTUDIO = /\[TOOL_REQUEST\]\s*([\s\S]*?)\s*\[END_TOOL_REQUEST\]/g;
const FENCED = /```(?:json)?\s*\n?([\s\S]*?)```/g;

export function parseTextToolCalls(text: string): TextToolCall[] {
  const tagged = [...collect(text, TAGGED), ...collect(text, LMSTUDIO)];
  if (tagged.length > 0) return tagged;
  // Los bloques ```json solo cuentan si TODO lo que traen es una llamada (un ejemplo de codigo no lo es).
  return collect(text, FENCED);
}

function collect(text: string, pattern: RegExp): TextToolCall[] {
  const calls: TextToolCall[] = [];
  for (const match of text.matchAll(pattern)) {
    const call = toCall(match[1] ?? '');
    if (call !== null) calls.push(call);
  }
  return calls;
}

function toCall(body: string): TextToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch (err) {
    // No es JSON: no es una llamada (es texto que se parece). No hay nada que reportar.
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : typeof record.tool === 'string' ? record.tool : null;
  if (name === null || name.trim().length === 0) return null;
  const args = record.arguments ?? record.parameters ?? record.input ?? {};
  const argumentsJson = typeof args === 'string' ? args : JSON.stringify(args);
  return { name: name.trim(), argumentsJson };
}

// Lo que se le explica a un modelo SIN herramientas nativas para que escriba las llamadas de forma que
// Mage las entienda: el formato y, por herramienta, su nombre y sus campos.
export function textToolInstructions(tools: readonly { readonly name: string; readonly description: string; readonly parameters: Readonly<Record<string, unknown>> }[]): string {
  const lines = tools.map((tool) => `- ${tool.name}(${fieldList(tool.parameters)}): ${tool.description.split('\n', 1)[0]}`);
  return [
    'To use a tool, write exactly one block like this and stop:',
    '<tool_call>{"name": "Read", "arguments": {"file_path": "README.md"}}</tool_call>',
    'You will get the result in the next message. Available tools:',
    ...lines,
  ].join('\n');
}

function fieldList(schema: Readonly<Record<string, unknown>>): string {
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null) return '';
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  return Object.keys(properties)
    .map((name) => (required.includes(name) ? name : `${name}?`))
    .join(', ');
}
