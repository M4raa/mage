// Peticiones pendientes de la terminal (F7): una a la vista y el resto en espera, en orden de llegada, sin repetir. Puro.

export class PromptDesk {
  #active = null;
  #waiting = [];

  offer(prompt) {
    const known = prompt.requestId === this.#active?.requestId || this.#waiting.some((p) => p.requestId === prompt.requestId);
    if (known) return 'duplicate';
    if (this.#active !== null) {
      this.#waiting.push(prompt);
      return 'queued';
    }
    this.#active = prompt;
    return 'shown';
  }

  active() {
    return this.#active;
  }

  replaceActive(prompt) {
    if (this.#active === null) throw new Error('No hay ninguna petición activa que sustituir');
    if (this.#active.requestId !== prompt.requestId) {
      throw new Error(`El prompt activo es ${this.#active.requestId} y se intentó sustituir por ${prompt.requestId}`);
    }
    this.#active = prompt;
  }

  resolve(requestId) {
    if (this.#active?.requestId === requestId) {
      this.#active = this.#waiting.shift() ?? null;
      return { wasActive: true, next: this.#active };
    }
    this.#waiting = this.#waiting.filter((p) => p.requestId !== requestId);
    return { wasActive: false, next: null };
  }

  clear() {
    this.#active = null;
    this.#waiting = [];
  }
}
