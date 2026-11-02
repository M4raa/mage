// Troceado de un flujo de bytes en líneas NDJSON, con tope de tamaño por línea (F2.6, frontera del host).
// Un cliente que manda una línea sin fin no puede hacer crecer la memoria de main: al pasar el límite el
// troceador avisa (`overflow`) y quien lo usa cierra la conexión. Puro y sin E/S: se prueba con cadenas.

// 1 MiB por línea: un mensaje con una imagen adjunta en base64 cabe de sobra; una línea mayor es un error o un abuso.
export const MAX_LINE_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export type FrameEvent =
  | { readonly kind: 'line'; readonly text: string }
  | { readonly kind: 'overflow'; readonly limit: number };

export class NdjsonFramer {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly maxLineBytes: number = MAX_LINE_BYTES) {
    if (!Number.isInteger(maxLineBytes) || maxLineBytes <= 0) {
      throw new Error(`El tope de línea debe ser un entero positivo: ${String(maxLineBytes)}`);
    }
  }

  // Devuelve las líneas completas que cierra `chunk` y, si alguna (o el resto sin cerrar) pasa el tope, un
  // `overflow` y nada más: tras un desbordamiento el flujo ya no es de fiar.
  push(chunk: Buffer): readonly FrameEvent[] {
    // ponytail: concatena todo lo pendiente en cada push; con trozos muy pequeños hasta el tope (1 MiB) el coste
    // es cuadrático, acotado por MAX_LINE_BYTES. Si un cliente real lo nota, lista de trozos y unir al cerrar línea.
    this.pending = Buffer.concat([this.pending, chunk]);
    const events: FrameEvent[] = [];
    for (let end = this.pending.indexOf(NEWLINE); end !== -1; end = this.pending.indexOf(NEWLINE)) {
      const line = this.takeLine(end);
      if (line.length > this.maxLineBytes) return [{ kind: 'overflow', limit: this.maxLineBytes }];
      if (line.length > 0) events.push({ kind: 'line', text: line.toString('utf8') });
    }
    if (this.pending.length > this.maxLineBytes) return [{ kind: 'overflow', limit: this.maxLineBytes }];
    return events;
  }

  // Quita de `pending` la línea que acaba en `end` (sin su salto, ni el `\r` previo si lo hay).
  private takeLine(end: number): Buffer {
    const raw = this.pending.subarray(0, end);
    this.pending = this.pending.subarray(end + 1);
    return raw.length > 0 && raw[raw.length - 1] === CARRIAGE_RETURN ? raw.subarray(0, raw.length - 1) : raw;
  }
}
