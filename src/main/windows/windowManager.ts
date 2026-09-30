// Varias ventanas del workbench (peticion del usuario: "tener en 2 pantallas la app"). NO son dos
// instancias: es UN proceso main con N ventanas, asi que todo lo que vive en main —ajustes, temas,
// permisos, carpetas de confianza, cuentas, sesiones del motor— es literalmente el mismo objeto para
// todas. Lo que cambia por ventana es lo que el renderer guarda por su cuenta: pestañas, disposicion
// de paneles, cuenta activa y conversaciones abiertas.
//
// Esta clase NO importa `electron` a proposito: recibe la fabrica de ventanas inyectada y trabaja
// contra el minimo contrato (`ManagedWindow`) que `BrowserWindow` ya cumple estructuralmente. Asi su
// test corre sin Electron, y la CONFIGURACION de la ventana (webPreferences incluidas) sigue viviendo
// en un solo sitio: la fabrica que pasa `index.ts`.

// Id de la ventana principal. Es una constante y no un id generado porque es la unica que existe
// desde el arranque y la que conserva el estado persistido de siempre (workspace-state.json).
export const MAIN_WINDOW_ID = 'main';

// Prefijo de las ventanas secundarias: w2, w3, ... El id es ESTABLE entre arranques (se reasigna el
// hueco libre mas bajo), asi la segunda ventana recupera el workspace que tenia la segunda ventana la
// vez anterior en vez de dejar un fichero huerfano por cada apertura.
const SECONDARY_ID_PREFIX = 'w';
const FIRST_SECONDARY_INDEX = 2;

// Lo minimo que el gestor necesita de una ventana. `BrowserWindow` lo cumple sin adaptador.
export interface ManagedWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
  on(event: 'closed', listener: () => void): unknown;
  readonly webContents: {
    readonly id: number;
    send(channel: string, payload: unknown): void;
  };
}

// Donde abrir una ventana nueva (esquina superior izquierda, en coordenadas de pantalla). Lo usa el
// arrastre de una pestaña fuera de Mage: la ventana nace bajo el cursor.
export interface WindowPlacement {
  readonly x: number;
  readonly y: number;
}

export interface WindowManagerDeps<W extends ManagedWindow> {
  // Crea la ventana REAL del workbench. Recibe el id ya asignado por si la fabrica quiere usarlo
  // (titulo, estado inicial); nunca lo elige ella.
  readonly createWindow: (windowId: string, placement?: WindowPlacement) => W;
  // Borra el estado persistido de ese id (pestañas, paneles). `openWith` lo llama ANTES de crear: los ids
  // se reasignan, y sin esto la ventana nueva restauraba lo que tenia la anterior con ese id y ADEMAS
  // adoptaba la pestaña movida (P-028 26: «se abre con mas cosas que la conversacion arrastrada»).
  readonly discardState?: (windowId: string) => void;
}

// Primer id libre: 'main' si nadie lo ocupa, y si no w2, w3, ... Se reutiliza el hueco mas bajo para
// que el numero de ventanas abiertas acote el numero de ficheros de estado por ventana.
export function nextWindowId(taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(MAIN_WINDOW_ID)) return MAIN_WINDOW_ID;
  for (let index = FIRST_SECONDARY_INDEX; ; index += 1) {
    const candidate = `${SECONDARY_ID_PREFIX}${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

// ¿Es un id de ventana con la forma que acuña `nextWindowId`? Se valida antes de usarlo como parte
// del nombre de un fichero de estado o como destino de un mensaje que llega por IPC: el renderer
// manda ids, y un id arbitrario no puede convertirse en una ruta.
export function isWindowId(value: string): boolean {
  return value === MAIN_WINDOW_ID || /^w[1-9]\d*$/.test(value);
}

export class WindowManager<W extends ManagedWindow, P = unknown> {
  // Insercion ordenada: `list()` devuelve las ventanas en el orden en que se abrieron, que es el que
  // el usuario reconoce en un selector de "mover a la ventana...".
  private readonly windows = new Map<string, W>();
  // Lo que espera a una ventana RECIEN abierta hasta que su renderer lo pida (P-028, 36). Empujarlo
  // con `send` nada mas crearla lo perdia: su renderer aun no habia registrado el listener, y la
  // pestaña movida desaparecia de las dos ventanas. Ahora el renderer nuevo lo RECOGE (`takePending`)
  // cuando ya ha cargado sus cuentas.
  private readonly pending = new Map<string, P[]>();

  constructor(private readonly deps: WindowManagerDeps<W>) {}

  // La ventana principal, creandola si no existe (o si el usuario la cerro). Es la entrada que usa
  // `focusMainWindow`: enfocar algo que se destruyo tiene que REABRIRLO, no lanzar.
  ensureMain(): W {
    const existing = this.get(MAIN_WINDOW_ID);
    if (existing !== null) return existing;
    return this.create(MAIN_WINDOW_ID);
  }

  // Abre una ventana NUEVA y devuelve su id (lo necesita el renderer para dirigirle una pestaña).
  open(placement?: WindowPlacement): { readonly windowId: string; readonly window: W } {
    const windowId = nextWindowId(this.list());
    return { windowId, window: this.create(windowId, placement) };
  }

  // Abre una ventana nueva con algo esperandola (una pestaña movida). Se encola ANTES de crearla: la
  // fabrica empieza a cargar el renderer y nada garantiza que no pida lo suyo enseguida.
  openWith(payload: P, placement?: WindowPlacement): string {
    const windowId = nextWindowId(this.list());
    this.pending.set(windowId, [payload]);
    try {
      this.deps.discardState?.(windowId);
      this.create(windowId, placement);
    } catch (err) {
      this.pending.delete(windowId);
      throw err;
    }
    return windowId;
  }

  // Lo que esperaba a esa ventana, UNA sola vez (una segunda llamada devuelve []).
  takePending(windowId: string): readonly P[] {
    const queued = this.pending.get(windowId) ?? [];
    this.pending.delete(windowId);
    return queued;
  }

  // La ventana viva con ese id, o null. Una ventana destruida se OLVIDA aqui: su evento `closed`
  // puede no haber llegado todavia (y llamar a cualquier metodo sobre ella lanzaria "Object has been
  // destroyed").
  get(windowId: string): W | null {
    const window = this.windows.get(windowId);
    if (window === undefined) return null;
    if (!window.isDestroyed()) return window;
    this.windows.delete(windowId);
    return null;
  }

  // Id de la ventana a la que pertenece un webContents (el `event.sender` de un mensaje IPC). Es lo
  // que permite que el estado por ventana y la difusion de ajustes sepan QUIEN habla sin fiarse de un
  // id que mande el renderer.
  windowIdOf(webContentsId: number): string | null {
    for (const [windowId, window] of this.windows) {
      if (!window.isDestroyed() && window.webContents.id === webContentsId) return windowId;
    }
    return null;
  }

  list(): readonly string[] {
    this.forgetDestroyed();
    return [...this.windows.keys()];
  }

  count(): number {
    return this.list().length;
  }

  // Trae una ventana al frente (restaurandola si estaba minimizada). false = ya no existe.
  focus(windowId: string): boolean {
    const window = this.get(windowId);
    if (window === null) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return true;
  }

  // Cierra UNA ventana. Las demas siguen vivas: no hay estado compartido que se destruya con ella (el
  // motor, las cuentas y los ajustes viven en main). false = ya no existia.
  close(windowId: string): boolean {
    const window = this.get(windowId);
    if (window === null) return false;
    window.close();
    return true;
  }

  // Empuja un mensaje a todas las ventanas vivas, opcionalmente saltandose la que lo origino (evita
  // el ECO: quien acaba de cambiar un ajuste ya lo tiene aplicado, y reaplicarselo puede devolverle un
  // valor viejo si tenia una edicion en curso).
  broadcast(channel: string, payload: unknown, exceptWebContentsId?: number): void {
    for (const windowId of this.list()) {
      const window = this.get(windowId);
      if (window === null) continue;
      if (exceptWebContentsId !== undefined && window.webContents.id === exceptWebContentsId) continue;
      window.webContents.send(channel, payload);
    }
  }

  // Manda un mensaje a UNA ventana concreta (mover una pestaña a otra ventana). Lanza con el id
  // recibido si no existe: el renderer eligio un destino y tiene que enterarse de que ya no esta, no
  // perder la pestaña en silencio.
  sendTo(windowId: string, channel: string, payload: unknown): void {
    const window = this.get(windowId);
    if (window === null) throw new Error(`No hay ninguna ventana de Mage con id ${JSON.stringify(windowId)}`);
    window.webContents.send(channel, payload);
  }

  // Crea, registra y engancha el olvido al cerrarse.
  private create(windowId: string, placement?: WindowPlacement): W {
    const window = this.deps.createWindow(windowId, placement);
    this.windows.set(windowId, window);
    window.on('closed', () => {
      // Solo si sigue siendo LA de este id: si se recreo (focusMainWindow tras cerrar la principal),
      // el `closed` tardio de la vieja no puede borrar la nueva.
      if (this.windows.get(windowId) !== window) return;
      this.windows.delete(windowId);
      this.pending.delete(windowId);
    });
    return window;
  }

  private forgetDestroyed(): void {
    for (const [windowId, window] of [...this.windows]) {
      if (window.isDestroyed()) this.windows.delete(windowId);
    }
  }
}
