// Control de acceso POR MODELO a las herramientas del runtime propio (§8.1 D10 de P-032): conceder o
// restringir, por proveedor del usuario. Vive en `shared` porque lo edita el renderer (Ajustes) y lo
// aplica main. PURO.
//
// Texto que escribe el usuario, una regla por linea:
//   *: -Bash                      ningun modelo de este proveedor usa Bash
//   qwen2.5-coder: Read, Glob     ese modelo SOLO puede usar Read y Glob
//   llama3: -mcp__github__*       ese modelo no usa nada del servidor MCP github
// Un nombre con `-` delante restringe; sin el, concede (y entonces solo vale lo concedido). `*` en un
// nombre casa con cualquier texto.

export interface ToolAccessRule {
  readonly model: string; // '*' = todos los modelos del proveedor
  readonly allow: readonly string[] | null; // null = sin lista de concedidas (todo lo no restringido)
  readonly deny: readonly string[];
}

export interface ToolAccessParse {
  readonly rules: readonly ToolAccessRule[];
  readonly errors: readonly string[];
}

const ALL_MODELS = '*';

export function parseToolAccessText(text: string): ToolAccessParse {
  const rules: ToolAccessRule[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) return;
    const colon = line.indexOf(':');
    if (colon <= 0) return void errors.push(`Línea ${index + 1}: falta «modelo:» delante (${line})`);
    const model = line.slice(0, colon).trim();
    const items = line
      .slice(colon + 1)
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length === 0) return void errors.push(`Línea ${index + 1}: no nombra ninguna herramienta (${line})`);
    const deny = items.filter((item) => item.startsWith('-')).map((item) => item.slice(1).trim()).filter((item) => item.length > 0);
    const allow = items.filter((item) => !item.startsWith('-'));
    rules.push({ model, allow: allow.length === 0 ? null : allow, deny });
  });
  return { rules, errors };
}

export function formatToolAccessRules(rules: readonly ToolAccessRule[]): string {
  return rules.map((rule) => `${rule.model}: ${[...(rule.allow ?? []), ...rule.deny.map((name) => `-${name}`)].join(', ')}`).join('\n');
}

// ¿Puede `model` usar `tool`? Sin reglas, todo. Una restriccion que casa gana siempre; si alguna regla
// del modelo concede una lista, solo vale lo que este en alguna de esas listas.
export function isToolAllowed(rules: readonly ToolAccessRule[], model: string, tool: string): boolean {
  const applicable = rules.filter((rule) => rule.model === ALL_MODELS || rule.model === model);
  if (applicable.some((rule) => rule.deny.some((pattern) => matches(pattern, tool)))) return false;
  const allowLists = applicable.flatMap((rule) => (rule.allow === null ? [] : [rule.allow]));
  return allowLists.length === 0 || allowLists.some((list) => list.some((pattern) => matches(pattern, tool)));
}

function matches(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const escaped = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`).test(name);
}
