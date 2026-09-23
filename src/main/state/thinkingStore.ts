import type { MageEvent } from '@shared/events';

// Texto del PENSAMIENTO del agente, que Mage guarda porque el CLI no lo guarda.
//
// MEDIDO: el CLI persiste los bloques `thinking` de su transcripcion con `"thinking": ""` — solo la
// firma, sin cuerpo. En vivo el texto SI llega (`thinking_delta`), asi que al reanudar una conversacion
// quedaba el "▸ Pensó" sin nada debajo. Peticion del usuario, literal: «eso ya lo sé, pero es que es
// Mage quien debería guardar lo que no guarda el CLI».
//
// Fichero POR SESION (`<dir>/<sessionId>.jsonl`, una linea = un bloque de pensamiento, en orden) y no
// una clave mas del indice de conversaciones: esto se escribe en CADA turno y puede pesar, mientras que
// `conversation-index.json` esta pensado para lo que se escribe poco y se lee al abrir. Es la misma
// razon por la que el catalogo de comandos tampoco vive alli.
//
// El orden ES la identidad: el N-esimo texto guardado corresponde al N-esimo bloque `thinking` vacio de
// la transcripcion. Las dos secuencias son de solo-añadir y se producen a la vez, asi que casan sin
// necesidad de inventar un id que el CLI no da.

export interface ThinkingStoreDeps {
  readonly dir: string;
  readonly join: (...parts: readonly string[]) => string;
  readonly exists: (path: string) => boolean;
  readonly mkdir: (path: string) => void;
  readonly appendFile: (path: string, data: string) => void;
  readonly readFile: (path: string) => string;
  readonly removeFile: (path: string) => void;
  // Reescritura COMPLETA del fichero, para la compactacion. Se inyecta atomica (tmp+rename) porque un
  // corte a mitad de reescribir se llevaria el historial entero de esa conversacion.
  readonly writeFile: (path: string, data: string) => void;
}

// Tope por bloque. Un pensamiento largo de verdad ronda unos pocos kB; 64 kB es holgado y a la vez
// impide que un turno degenerado deje un fichero de megabytes que luego hay que leer entero al abrir.
export const MAX_THINKING_CHARS = 64 * 1024;
// Tope por conversacion. Al pasarse se dejan los MAS RECIENTES: al reanudar interesa lo ultimo que
// penso el agente, no lo que penso hace doscientos turnos.
export const MAX_THINKING_BLOCKS = 400;
// Cuantos bloques se dejan acumular ANTES de compactar. La histeresis es lo que hace que el recorte
// salga barato: compactar en cuanto se pasa de 400 reescribiria el fichero en CADA turno a partir de
// ahi; con 500 se reescribe una vez cada 100. Antes el tope era solo de PRESENTACION -se aplicaba en
// `read()`, sobre el fichero ya leido entero- y el .jsonl crecia sin limite: una conversacion reanudada
// durante semanas dejaba decenas de MB que se leian y parseaban en el main al abrirla (auditoria B.4.1).
export const COMPACT_AT_BLOCKS = 500;

export class ThinkingStore {
  // Bloques ya escritos por sesion, para decidir cuando compactar sin preguntarle al disco.
  private readonly counts = new Map<string, number>();

  constructor(private readonly deps: ThinkingStoreDeps) {}

  // Guarda un bloque de pensamiento ya completo. Ignora el vacio: un bloque sin texto no aporta nada y
  // ademas descuadraria la correspondencia por orden con la transcripcion.
  append(sessionId: string, text: string): void {
    if (sessionId.length === 0) throw new Error(`sessionId vacio al guardar un pensamiento: ${JSON.stringify(sessionId)}`);
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (!this.deps.exists(this.deps.dir)) this.deps.mkdir(this.deps.dir);
    const capped = trimmed.length > MAX_THINKING_CHARS ? `${trimmed.slice(0, MAX_THINKING_CHARS)}…` : trimmed;
    const path = this.pathFor(sessionId);
    this.deps.appendFile(path, `${JSON.stringify(capped)}\n`);
    // La cuenta se lleva en memoria para no tocar disco en cada turno. La PRIMERA vez de cada sesion no
    // se sabe (el proceso puede acabar de arrancar sobre un fichero ya crecido), asi que se cuenta
    // leyendo: pasa una vez por sesion y por proceso, y deja el fichero compactado para siempre.
    // Ojo al orden: la linea YA esta escrita, asi que contar leyendo da el total FINAL y no hay que
    // sumarle uno; solo se suma cuando la cuenta venia de memoria.
    const known = this.counts.get(sessionId);
    const count = known === undefined ? this.readAll(path).length : known + 1;
    if (count <= COMPACT_AT_BLOCKS) {
      this.counts.set(sessionId, count);
      return;
    }
    const kept = this.readAll(path).slice(-MAX_THINKING_BLOCKS);
    this.deps.writeFile(path, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
    this.counts.set(sessionId, kept.length);
  }

  // Los pensamientos de una conversacion, en orden. Vacio si no hay fichero (conversaciones anteriores
  // a esto, o sin pensamiento ninguno), que es lo que deja el "▸ Pensó" como estaba.
  read(sessionId: string): readonly string[] {
    const texts = this.readAll(this.pathFor(sessionId));
    // El recorte se sigue aplicando AQUI ademas de al escribir: un fichero que ya venia crecido de antes
    // de la compactacion no se cura hasta su siguiente turno, y no hay que servirle 20.000 bloques al
    // panel mientras tanto.
    return texts.length > MAX_THINKING_BLOCKS ? texts.slice(texts.length - MAX_THINKING_BLOCKS) : texts;
  }

  // Todas las lineas validas del fichero, en orden. Vacio si no existe.
  private readAll(path: string): readonly string[] {
    if (!this.deps.exists(path)) return [];
    const texts: string[] = [];
    for (const line of this.deps.readFile(path).split('\n')) {
      if (line.trim().length === 0) continue;
      // Una linea rota no puede tumbar la lectura entera: se descarta esa y siguen las demas. Escribir
      // es append + salto de linea, asi que la unica linea que puede quedar a medias es la ultima.
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'string') texts.push(parsed);
      } catch {
        continue;
      }
    }
    return texts;
  }

  // Se llama al borrar una conversacion: si no, quedaria un fichero huerfano por cada una borrada.
  forget(sessionId: string): void {
    this.counts.delete(sessionId);
    const path = this.pathFor(sessionId);
    if (this.deps.exists(path)) this.deps.removeFile(path);
  }

  private pathFor(sessionId: string): string {
    // El sessionId del CLI es un UUID, pero viene de fuera: se sanea igual antes de meterlo en una
    // ruta. Sin esto, un id con `..` o barras escribiria donde no debe.
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
    return this.deps.join(this.deps.dir, `${safe}.jsonl`);
  }
}

// Acumulador de los `thinking_delta` de UNA sesion. El CLI no marca el final de un bloque de
// pensamiento, asi que el cierre se deduce: llega un evento que NO es un delta de pensamiento.
//
// PURO en su decision (estado -> que hacer), para poder probar el cierre sin disco ni procesos.
export class ThinkingBuffer {
  private buffer = '';

  // Devuelve el texto COMPLETO del bloque si este evento lo cierra, o null si no hay nada que cerrar.
  // El llamante decide que hacer con el (guardarlo); aqui no se toca disco.
  accept(event: MageEvent): string | null {
    if (event.kind === 'thinking_delta') {
      this.buffer += event.text;
      return null;
    }
    // Todo lo demas cierra el bloque en curso: el siguiente trozo de respuesta, una herramienta, el
    // fin de turno. Si no habia nada acumulado, no hay bloque que cerrar.
    if (this.buffer.length === 0) return null;
    const text = this.buffer;
    this.buffer = '';
    return text;
  }

  // Cierre forzado al terminar la sesion: el ultimo bloque puede no tener ningun evento detras.
  flush(): string | null {
    if (this.buffer.length === 0) return null;
    const text = this.buffer;
    this.buffer = '';
    return text;
  }
}
