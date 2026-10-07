import { classifySystemWrapper } from '@shared/systemWrappers';
import type { NeutralConversation, NeutralItem, NeutralToolItem } from '@shared/neutralConversation';

// Líneas con la forma de transcripción de Claude (`type: user|assistant`, `message.content`) → conversación
// neutral. Es la forma a la que ya traducen su historial los tres CLI: Claude la escribe tal cual, y los lectores
// de Codex (`adaptCodexLine`) y de agy (`agyStepsToLines`) la producen.

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

function timeOf(line: Rec): number | null {
  const parsed = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (isRec(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('');
}

interface Builder {
  readonly items: NeutralItem[];
  readonly toolIndex: Map<string, number>;
}

function addUserBlocks(builder: Builder, content: unknown, atMs: number | null): void {
  if (typeof content === 'string') return addUserText(builder, content, atMs);
  if (!Array.isArray(content)) return;
  const texts: string[] = [];
  for (const block of content) {
    if (!isRec(block)) continue;
    if (block.type === 'tool_result') fillToolResult(builder, block);
    else if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
  }
  addUserText(builder, texts.join('\n'), atMs);
}

// Los envoltorios que el CLI guarda como mensaje del usuario (`/rename`, avisos, recordatorios) no son conversación.
function addUserText(builder: Builder, text: string, atMs: number | null): void {
  if (text.trim().length === 0 || classifySystemWrapper(text).kind !== 'plain') return;
  builder.items.push({ kind: 'user', text, atMs });
}

function fillToolResult(builder: Builder, block: Rec): void {
  const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
  const index = builder.toolIndex.get(id);
  const current = index === undefined ? undefined : builder.items[index];
  if (index === undefined || current === undefined || current.kind !== 'tool') return;
  builder.items[index] = { ...current, output: textOf(block.content), isError: block.is_error === true };
}

function addAssistantBlocks(builder: Builder, content: unknown, atMs: number | null): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRec(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
      builder.items.push({ kind: 'assistant', text: block.text, atMs });
    } else if (block.type === 'tool_use' && typeof block.id === 'string') {
      const tool: NeutralToolItem = { kind: 'tool', id: block.id, name: String(block.name ?? 'tool'), input: isRec(block.input) ? block.input : {}, output: '', isError: false, atMs };
      builder.toolIndex.set(block.id, builder.items.length);
      builder.items.push(tool);
    }
  }
}

export function neutralFromLines(lines: readonly unknown[], meta: { readonly cwd: string; readonly title: string }): NeutralConversation {
  const builder: Builder = { items: [], toolIndex: new Map() };
  for (const line of lines) {
    if (!isRec(line) || line.isSidechain === true || line.isMeta === true || !isRec(line.message)) continue;
    const atMs = timeOf(line);
    if (line.type === 'user') addUserBlocks(builder, line.message.content, atMs);
    else if (line.type === 'assistant') addAssistantBlocks(builder, line.message.content, atMs);
  }
  return { cwd: meta.cwd, title: meta.title, items: builder.items };
}
