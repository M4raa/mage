// Los elementId son efímeros: los de una lectura caducan con la siguiente.
// Los ids crecen sin reiniciarse para que un id viejo NUNCA apunte a un elemento nuevo.
import type { RawDomElement } from './domSnapshot';

export interface DomElement extends RawDomElement {
  id: number;
}

export class ElementRegistry {
  private nextId = 1;
  private current = new Map<number, DomElement>();

  /** Sustituye la lectura anterior por la nueva y asigna un id a cada elemento, en orden. */
  replace(elements: readonly RawDomElement[]): DomElement[] {
    this.current.clear();
    const registered = elements.map((element) => {
      const entry: DomElement = { id: this.nextId++, ...element };
      this.current.set(entry.id, entry);
      return entry;
    });
    return registered;
  }

  /** Devuelve el elemento de la última lectura; lanza si el id no existe o ya caducó. */
  resolve(id: number): DomElement {
    const element = this.current.get(id);
    if (element === undefined) {
      throw new Error(
        `El elemento ${id} no existe o ha caducado: los ids solo valen para la última lectura del DOM`,
      );
    }
    return element;
  }

  /** Caduca todos los ids sin reiniciar el contador. */
  clear(): void {
    this.current.clear();
  }
}
