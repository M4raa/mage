// Tarjeta de una subsesión creada con `mage_create_session` (como las de artifact, pero de datos más simples).
// PURO y compartido por las dos rutas que construyen bloques (el directo y la transcripción): en Claude la
// herramienta se llama `mcp__mage__mage_create_session` y en Codex igual (`mcp__<servidor>__<herramienta>`).

const DELEGATION_TOOL_SUFFIX = 'mage_create_session';
// Mismo tope que el nombre de la subsesión en main (`MAX_SESSION_TITLE_CHARS`).
const MAX_DELEGATION_TITLE_CHARS = 80;

export interface DelegationDraft {
  readonly title: string;
}

export interface DelegationCard extends DelegationDraft {
  readonly conversationId: string;
}

function readText(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value.trim() : '';
}

// Nombre de la subsesión desde el INPUT de la herramienta: `title` si lo dio la creadora; si no, la primera línea
// del prompt (como hace main). `null` si no es una llamada a `mage_create_session`.
export function parseDelegationDraft(toolName: string, input: Readonly<Record<string, unknown>>): DelegationDraft | null {
  if (!toolName.endsWith(DELEGATION_TOOL_SUFFIX)) return null;
  const title = readText(input, 'title');
  const firstLine = readText(input, 'prompt').split('\n')[0]?.trim() ?? '';
  return { title: (title.length > 0 ? title : firstLine).slice(0, MAX_DELEGATION_TITLE_CHARS) };
}

// Completa el borrador con el `conversationId` del resultado (un JSON). `null` si el texto no se puede leer o no
// trae ninguno: entonces no hay tarjeta y se pinta la caja de herramienta de siempre.
export function completeDelegation(draft: DelegationDraft, output: string): DelegationCard | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    // Contrato: un resultado que no es JSON (el error de la herramienta, p. ej.) no es una subsesión creada.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const conversationId = (parsed as Record<string, unknown>).conversationId;
  if (typeof conversationId !== 'string' || conversationId.length === 0) return null;
  return { ...draft, conversationId };
}
