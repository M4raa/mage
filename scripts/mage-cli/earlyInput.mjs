// Lo que se escribe en `mage chat` antes de que la conversación esté lista (crear la sesión y suscribirse tarda): se
// guarda y se entrega en orden al estarlo. Un fin de entrada temprano (Ctrl+D, una tubería que acaba) espera a que se
// haya entregado todo. Sin dependencias: el destino llega por `drainTo`.
export class EarlyInput {
  #lines = [];
  #ended = false;
  #sink = null;

  // Antes de `drainTo` se guarda; después va directo al destino.
  push(text) {
    if (this.#sink !== null) return this.#sink.onLine(text);
    this.#lines.push(text);
    return undefined;
  }

  end() {
    if (this.#sink !== null) return this.#sink.onEnd();
    this.#ended = true;
    return undefined;
  }

  // Entrega lo guardado de uno en uno (esperando cada envío) y, desde entonces, todo va directo. Lo que llegue mientras
  // entrega se encola detrás. `sink`: { onLine(text): Promise|void, onEnd(): void }.
  async drainTo(sink) {
    if (this.#sink !== null) throw new Error('EarlyInput: drainTo ya se llamó');
    while (this.#lines.length > 0) await sink.onLine(this.#lines.shift());
    this.#sink = sink;
    if (this.#ended) sink.onEnd();
  }
}
