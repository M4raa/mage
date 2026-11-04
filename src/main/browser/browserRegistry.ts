// Un navegador aislado por sesión VIVA de Mage (D-S1) y su estado de control (D-S2). Lo usan las herramientas
// MCP (la sesión que llama, resuelta por main) y el panel. Sin Electron.
import type { BrowserPageState, IsolatedBrowser } from './isolatedBrowser';

export const BROWSER_SWEEP_INTERVAL_MS = 30_000;

export type BrowserControl = 'idle' | 'agent' | 'user';
export type BrowserAgentAction = 'navigate' | 'screenshot' | 'read_dom' | 'click' | 'type' | 'back' | 'close';

export interface BrowserEntryState extends BrowserPageState {
  readonly sessionId: string;
  readonly control: BrowserControl;
  readonly lastAction: BrowserAgentAction | null;
}

export type BrowserHandle = Pick<
  IsolatedBrowser,
  | 'view'
  | 'navigate'
  | 'captureRaw'
  | 'readDom'
  | 'click'
  | 'type'
  | 'back'
  | 'reload'
  | 'close'
  | 'releaseControl'
  | 'state'
  | 'onStateChange'
  | 'setBounds'
  | 'setVisible'
>;

export type BrowserControlErrorCode = 'session_not_live' | 'browser_not_open' | 'browser_user_in_control';

export class BrowserControlError extends Error {
  constructor(
    readonly code: BrowserControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserControlError';
  }
}

export interface BrowserRegistryDeps {
  readonly createBrowser: (instanceId: string) => BrowserHandle;
  readonly newId: () => string;
  readonly isLive: (sessionId: string) => boolean;
  readonly onChange: (states: readonly BrowserEntryState[]) => void;
  readonly onOpened: (sessionId: string, handle: BrowserHandle) => void; // S03: colocar la vista
  readonly onClosed: (sessionId: string, handle: BrowserHandle) => void; // S03: quitarla de su ventana
  readonly log: (level: 'info' | 'warn', message: string, data?: unknown) => void;
}

interface Entry {
  readonly handle: BrowserHandle;
  control: BrowserControl;
  lastAction: BrowserAgentAction | null;
  readonly unsubscribe: () => void;
}

export class BrowserRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: BrowserRegistryDeps) {}

  open(sessionId: string): BrowserHandle {
    this.sweep();
    if (!this.deps.isLive(sessionId)) {
      throw new BrowserControlError('session_not_live', `La sesión ${sessionId} no está viva`);
    }
    const existing = this.entries.get(sessionId);
    if (existing !== undefined) return existing.handle;
    const handle = this.deps.createBrowser(this.deps.newId());
    const unsubscribe = handle.onStateChange(() => this.emit());
    this.entries.set(sessionId, { handle, control: 'idle', lastAction: null, unsubscribe });
    this.deps.onOpened(sessionId, handle);
    this.emit();
    return handle;
  }

  get(sessionId: string): BrowserHandle | null {
    this.sweep();
    return this.entries.get(sessionId)?.handle ?? null;
  }

  beginAgentAction(sessionId: string, action: BrowserAgentAction): BrowserHandle {
    if (action === 'navigate') this.open(sessionId);
    const entry = this.requireEntry(sessionId, 'No hay navegador abierto en esta sesión: navega primero con mage_browser_navigate');
    if (entry.control === 'user') {
      throw new BrowserControlError(
        'browser_user_in_control',
        'El usuario ha tomado el control del navegador: espera a que lo devuelva',
      );
    }
    entry.control = 'agent';
    entry.lastAction = action;
    this.emit();
    return entry.handle;
  }

  beginUserAction(sessionId: string): BrowserHandle {
    const handle = this.open(sessionId);
    // P-S2: el usuario usa la barra del panel: toma el control.
    if (this.entries.get(sessionId)?.control === 'agent') this.takeControl(sessionId);
    return handle;
  }

  takeControl(sessionId: string): void {
    const entry = this.requireEntry(sessionId);
    entry.control = 'user';
    entry.handle.releaseControl();
    this.emit();
  }

  returnControl(sessionId: string): void {
    this.requireEntry(sessionId).control = 'idle';
    this.emit();
  }

  async close(sessionId: string): Promise<boolean> {
    const entry = this.entries.get(sessionId);
    if (entry === undefined) return false;
    this.entries.delete(sessionId);
    entry.unsubscribe();
    this.deps.onClosed(sessionId, entry.handle);
    try {
      await entry.handle.close();
    } catch (error) {
      // La entrada ya no existe: el fallo se registra y no se relanza.
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log('warn', 'No se pudo cerrar el navegador de la sesión', { sessionId, error: message });
    }
    this.emit();
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((sessionId) => this.close(sessionId)));
  }

  // ponytail: se barre en cada acceso y cada BROWSER_SWEEP_INTERVAL_MS (index.ts); un aviso del coordinador
  // al cerrar una sesión lo haría inmediato.
  sweep(): void {
    for (const sessionId of [...this.entries.keys()]) {
      if (!this.deps.isLive(sessionId)) void this.close(sessionId);
    }
  }

  states(): readonly BrowserEntryState[] {
    return [...this.entries].map(([sessionId, entry]) => ({
      ...entry.handle.state(),
      sessionId,
      control: entry.control,
      lastAction: entry.lastAction,
    }));
  }

  private requireEntry(sessionId: string, message?: string): Entry {
    const entry = this.entries.get(sessionId);
    if (entry === undefined) {
      throw new BrowserControlError(
        'browser_not_open',
        message ?? `No hay navegador abierto en la sesión ${sessionId}`,
      );
    }
    return entry;
  }

  private emit(): void {
    this.deps.onChange(this.states());
  }
}
