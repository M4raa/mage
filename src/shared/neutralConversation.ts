// Conversación en un formato NEUTRAL, común a los CLI (Claude, Codex, agy): lo que hace falta para seguir la
// MISMA conversación en otro proveedor. Cada CLI tiene su lector (a este modelo) y su escritor (desde él); se
// pierde lo que no es conversación: pensamientos, imágenes, metadatos propios de cada CLI.

export interface NeutralTextItem {
  readonly kind: 'user' | 'assistant';
  readonly text: string;
  readonly atMs: number | null;
}

export interface NeutralToolItem {
  readonly kind: 'tool';
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: string;
  readonly isError: boolean;
  readonly atMs: number | null;
}

export type NeutralItem = NeutralTextItem | NeutralToolItem;

export interface NeutralConversation {
  readonly cwd: string;
  readonly title: string;
  readonly items: readonly NeutralItem[];
}
