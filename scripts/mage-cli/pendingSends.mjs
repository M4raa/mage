// Envíos (`session.send`) sin respuesta (F7.3, reconexión de D2): si la conexión cae antes de la respuesta, no se
// sabe si el host lo recibió; quedan «inciertos» y se preguntan al usuario con su mismo `commandId`. Puro.

export class PendingSends {
  #sends = new Map();

  track(commandId, text) {
    if (this.#sends.has(commandId)) throw new Error(`El commandId ya está en vuelo: ${commandId}`);
    this.#sends.set(commandId, { commandId, text, uncertain: false });
  }

  settle(commandId) {
    this.#sends.delete(commandId);
  }

  // Los no resueltos, en orden de envío (un Map conserva el de inserción), marcados como inciertos.
  markAllUncertain() {
    const unresolved = [...this.#sends.values()];
    for (const send of unresolved) send.uncertain = true;
    return unresolved.map(({ commandId, text }) => ({ commandId, text }));
  }

  takeUncertain() {
    const uncertain = [...this.#sends.values()].filter((send) => send.uncertain);
    for (const send of uncertain) this.#sends.delete(send.commandId);
    return uncertain.map(({ commandId, text }) => ({ commandId, text }));
  }
}
