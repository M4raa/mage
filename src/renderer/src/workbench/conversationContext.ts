import type { Block } from './types';

// Contexto con el que una conversación de OTRO proveedor sigue en uno nuevo («Migrar la conversación» entre
// CLI): cada CLI guarda su historial en su formato y ninguno acepta el de otro, así que lo común es el hilo
// que Mage ya tiene en bloques. Se entrega al arrancar la sesión como instrucciones, no como mensajes.

// Tope del texto: las instrucciones de arranque cuentan en el contexto del modelo. Entra lo más reciente.
export const IMPORTED_CONTEXT_MAX_CHARS = 24_000;
const TOOL_COMMAND_MAX_CHARS = 160;

export interface ImportedContextSource {
  readonly title: string;
  readonly fromProvider: string;
}

function lineFor(block: Block): string | null {
  if (block.kind === 'user') return block.text.trim().length === 0 ? null : `Usuario: ${block.text.trim()}`;
  if (block.kind === 'agent') {
    const text = block.runs.map((run) => run.text).join('').trim();
    return text.length === 0 ? null : `Asistente: ${text}`;
  }
  if (block.kind === 'tool') return `[herramienta ${block.tool}: ${block.command.trim().slice(0, TOOL_COMMAND_MAX_CHARS)}${block.isError ? ' (con error)' : ''}]`;
  return null;
}

// Texto de contexto, o null si la conversación no tiene nada que contar.
export function importedConversationContext(blocks: readonly Block[], source: ImportedContextSource, maxChars = IMPORTED_CONTEXT_MAX_CHARS): string | null {
  const lines = blocks.map(lineFor).filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (size + line.length > maxChars && kept.length > 0) break;
    kept.unshift(line.length > maxChars ? line.slice(line.length - maxChars) : line);
    size += line.length;
  }
  const omitted = lines.length - kept.length;
  const header = [
    `Esta conversación continúa otra anterior («${source.title}») que se mantuvo con ${source.fromProvider}.`,
    'Lo que sigue es su historial, solo como contexto: no repitas el trabajo ya hecho y continúa donde quedó.',
    omitted > 0 ? `(Se omiten los ${omitted} mensajes más antiguos.)` : '',
  ].filter((line) => line.length > 0);
  return [...header, '', ...kept].join('\n');
}
