// Tamaño, posicion y maximizado de cada ventana del workbench (P-028, punto 29 bug 3). Antes la
// ventana nacia SIEMPRE con 1200x800 centrada: ni el tamaño ni la pantalla elegida sobrevivian a un
// reinicio. Se guarda POR VENTANA (id estable: main, w2, ...) en un solo fichero de userData.
//
// Sin `electron`: la validacion contra las pantallas y el fichero van con dependencias inyectadas, asi
// que se prueban sin arrancar nada. `index.ts` pasa `screen.getAllDisplays()` y el FS real.

import { z } from 'zod';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SavedWindowBounds extends Rect {
  readonly maximized: boolean;
}

// Cuanto de la ventana tiene que caer dentro de alguna pantalla para restaurarla ahi. Una ventana que
// se guardo en un monitor que ya no esta (portatil desenchufado) caeria fuera de toda pantalla y no
// habria forma de alcanzarla con el raton: por debajo de este solape se abre con el tamaño por defecto.
export const MIN_VISIBLE_PX = 100;

const RECT_FIELDS = {
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};
const SAVED_SCHEMA = z.object({ ...RECT_FIELDS, maximized: z.boolean() });
// Laxo por entrada: una ventana con basura se descarta sin tirar las demas.
const FILE_SCHEMA = z.record(z.string(), z.unknown());

function overlap(a: Rect, b: Rect): { readonly width: number; readonly height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

// Los bounds guardados si siguen cayendo en una pantalla existente (con al menos MIN_VISIBLE_PX de
// ancho y de alto dentro de su area de trabajo), o null para abrir con el tamaño por defecto. El
// tamaño se acota al minimo de la ventana: un fichero editado a mano no puede dejarla de 10 px.
export function fitSavedBounds(
  saved: SavedWindowBounds | null,
  workAreas: readonly Rect[],
  minSize: { readonly width: number; readonly height: number },
): SavedWindowBounds | null {
  if (saved === null) return null;
  const sized = { ...saved, width: Math.max(saved.width, minSize.width), height: Math.max(saved.height, minSize.height) };
  const visible = workAreas.some((area) => {
    const inside = overlap(sized, area);
    return inside.width >= MIN_VISIBLE_PX && inside.height >= MIN_VISIBLE_PX;
  });
  return visible ? sized : null;
}

export interface WindowBoundsStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
}

export class WindowBoundsStore {
  constructor(private readonly deps: WindowBoundsStoreDeps) {}

  // Los bounds de una ventana, o null si no hay (o no son validos). Fichero ausente o JSON corrupto =
  // sin dato: es una comodidad, no un dato de negocio. Un fallo de LECTURA (EBUSY) si lanza, como en
  // WorkspaceStore, para que el siguiente `save` no pise el fichero con una sola ventana.
  load(windowId: string): SavedWindowBounds | null {
    const entry = this.readAll()[windowId];
    const parsed = SAVED_SCHEMA.safeParse(entry);
    return parsed.success ? parsed.data : null;
  }

  save(windowId: string, bounds: SavedWindowBounds): void {
    const parsed = SAVED_SCHEMA.safeParse(bounds);
    if (!parsed.success) {
      throw new Error(`Bounds de ventana invalidos para ${JSON.stringify(windowId)}: ${JSON.stringify(bounds)}`);
    }
    const next = { ...this.readAll(), [windowId]: parsed.data };
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(next, null, 2));
  }

  private readAll(): Record<string, unknown> {
    if (!this.deps.exists(this.deps.filePath)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return {};
    }
    const result = FILE_SCHEMA.safeParse(parsed);
    return result.success ? result.data : {};
  }
}
