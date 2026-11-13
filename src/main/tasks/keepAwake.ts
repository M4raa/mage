// «Mantener activo»: impide que el equipo se suspenda mientras haya tareas programadas activas.
// El bloqueador de energía llega inyectado (en producción, `powerSaveBlocker` de Electron).
export interface PowerBlocker {
  readonly start: () => number;
  readonly stop: (id: number) => void;
}

export class KeepAwake {
  private blockerId: number | null = null;

  constructor(private readonly blocker: PowerBlocker) {}

  // Idempotente: arranca el bloqueo una sola vez y lo suelta cuando ya no se quiere.
  sync(wanted: boolean): void {
    if (wanted && this.blockerId === null) {
      this.blockerId = this.blocker.start();
      return;
    }
    if (!wanted && this.blockerId !== null) {
      this.blocker.stop(this.blockerId);
      this.blockerId = null;
    }
  }
}
