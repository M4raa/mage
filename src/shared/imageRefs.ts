import type { ImageAttachment } from './ipc';

// Referencias a las imagenes pegadas en el prompt (P-026 3.2, D13). Con cinco imagenes y «fijate en
// esta», el modelo no sabia cual: ahora pegar deja un token `[Imagen N]` donde esta el cursor, y al
// enviar cada imagen viaja JUSTO DETRAS de su token. MEDIDO (S3, CLI 2.1.283, `engine-spike --images`):
// el CLI respeta el orden [texto, img, texto, img, texto] —haiku contesto bien a «¿de que color es la
// Imagen 2?»— y lo guarda asi en el `.jsonl`. N es la posicion en `attachments`, en base 1.
//
// PURO y compartido: el renderer inserta y renumera tokens; main (claudeAdapter) monta el mensaje.

export function imageToken(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Numero de imagen invalido: ${JSON.stringify(n)}`);
  return `[Imagen ${n}]`;
}

// Cualquier token del texto, capturando su numero.
const TOKEN_PATTERN = /\[Imagen (\d+)\]/g;

export interface TextWithSelection {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

// Inserta `count` tokens seguidos (desde `fromN`) en el cursor, sustituyendo la seleccion, con un
// espacio de separacion donde haga falta. El cursor queda detras del ultimo, listo para seguir escribiendo.
export function insertImageTokens(state: TextWithSelection, fromN: number, count: number): TextWithSelection {
  if (!Number.isInteger(count) || count < 0) throw new Error(`Numero de tokens invalido: ${JSON.stringify(count)}`);
  if (count === 0) return state;
  const before = state.value.slice(0, state.selectionStart);
  const after = state.value.slice(state.selectionEnd);
  const tokens = Array.from({ length: count }, (_, i) => imageToken(fromN + i)).join(' ');
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${tokens}${trail}`;
  const caret = before.length + lead.length + tokens.length;
  return { value: `${before}${inserted}${after}`, selectionStart: caret, selectionEnd: caret };
}

// Quita el token de la imagen `n` (y un espacio que lo separe) y RENUMERA los de detras: la imagen n+1
// pasa a ser la n, igual que en `attachments` al quitar una miniatura.
export function removeImageToken(text: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Numero de imagen invalido: ${JSON.stringify(n)}`);
  // Con espacio a los dos lados se deja uno; con espacio a un solo lado, ninguno.
  const removed = text.replace(new RegExp(`( ?)\\[Imagen ${n}\\]( ?)`, 'g'), (_m, lead: string, trail: string) =>
    lead.length > 0 && trail.length > 0 ? ' ' : '',
  );
  return removed.replace(TOKEN_PATTERN, (token, digits: string) => {
    const k = Number(digits);
    return k > n ? imageToken(k - 1) : token;
  });
}

export type UserContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly source: { readonly type: 'base64'; readonly media_type: string; readonly data: string } };

// El contenido del mensaje: el texto partido por los tokens y cada imagen justo detras del PRIMER token
// suyo. Juntar los textos con '' devuelve el texto original (asi lo reconstruye `transcriptToBlocks` al
// reabrir). Una imagen cuyo token borro el usuario va al final, detras de su etiqueta; un token sin
// imagen se queda como texto. Nunca se emite un bloque de texto vacio (la API lo rechaza).
export function buildUserContentBlocks(text: string, attachments: readonly ImageAttachment[]): readonly UserContentBlock[] {
  const blocks: UserContentBlock[] = [];
  const placed = new Set<number>();
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const n = Number(match[1]);
    const attachment = attachments[n - 1];
    if (attachment === undefined || placed.has(n)) continue;
    const end = (match.index ?? 0) + match[0].length;
    pushText(blocks, text.slice(cursor, end));
    blocks.push(imageBlock(attachment));
    placed.add(n);
    cursor = end;
  }
  pushText(blocks, text.slice(cursor));
  attachments.forEach((attachment, index) => {
    if (placed.has(index + 1)) return;
    // Con un espacio delante si ya hay algo: al reabrir, los textos se juntan y se leeria «mira[Imagen 1]».
    pushText(blocks, `${blocks.length > 0 ? ' ' : ''}${imageToken(index + 1)}`);
    blocks.push(imageBlock(attachment));
  });
  return blocks;
}

function pushText(blocks: UserContentBlock[], text: string): void {
  if (text.length > 0) blocks.push({ type: 'text', text });
}

function imageBlock(attachment: ImageAttachment): UserContentBlock {
  return { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data } };
}
