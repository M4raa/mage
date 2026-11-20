import type { SessionMetadata } from './sessionsPort';

// Sesiones delegadas que esperan a que el usuario las lance desde la tarjeta de su creadora. Es el ÚNICO sitio de main
// que sabe que una está pendiente; uno para todas las conexiones del MCP (la tarjeta se contesta por el IPC, no por la
// conexión que la pidió). Vive en memoria: tras reiniciar Mage no queda ninguna y nada se lanza solo.

export interface LaunchChoice {
  readonly model?: string;
  readonly effort?: string;
}

export interface PendingLaunch {
  readonly id: string;
  readonly creatorSessionId: string;
  readonly requestId: string;
  readonly metadata: SessionMetadata;
  readonly since: string;
  // Arranca la sesión por el camino de siempre con lo elegido; lanza si lo elegido no vale (y sigue pendiente).
  readonly start: (choice: LaunchChoice) => Promise<void>;
  // El usuario no la lanzó: avisa a la creadora.
  readonly discard: () => void;
}

export type PendingStatus = 'pending' | 'launching' | 'cancelled';

interface Entry {
  readonly launch: PendingLaunch;
  status: PendingStatus;
}

// ponytail: las canceladas se quedan (para contestar `interrupted`) hasta reiniciar; son unas pocas por sesión de trabajo.
export class PendingLaunches {
  private readonly entries = new Map<string, Entry>();

  add(launch: PendingLaunch): void {
    if (this.entries.has(launch.id)) throw new Error(`La sesión ya espera a lanzarse: ${launch.id}`);
    this.entries.set(launch.id, { launch, status: 'pending' });
  }

  find(id: string): { readonly launch: PendingLaunch; readonly status: PendingStatus } | null {
    const entry = this.entries.get(id);
    return entry === undefined ? null : { launch: entry.launch, status: entry.status };
  }

  // La misma petición de la misma creadora (repetir `requestId`) no crea otra tarjeta.
  byRequest(creatorConversationId: string, requestId: string): PendingLaunch | null {
    for (const { launch } of this.entries.values()) {
      if (launch.requestId === requestId && launch.metadata.createdBy?.conversationId === creatorConversationId) return launch;
    }
    return null;
  }

  list(): readonly { readonly launch: PendingLaunch; readonly status: PendingStatus }[] {
    return [...this.entries.values()].map((entry) => ({ launch: entry.launch, status: entry.status }));
  }

  async launch(id: string, choice: LaunchChoice): Promise<void> {
    const entry = this.requirePending(id);
    entry.status = 'launching';
    try {
      await entry.launch.start(choice);
    } catch (error) {
      entry.status = 'pending';
      throw error;
    }
    this.entries.delete(id);
  }

  cancel(id: string): void {
    const entry = this.requirePending(id);
    entry.status = 'cancelled';
    entry.launch.discard();
  }

  private requirePending(id: string): Entry {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new Error(`No hay ninguna sesión esperando a lanzarse con ese id: ${id}`);
    if (entry.status !== 'pending') throw new Error(`La sesión ${id} ya no espera a lanzarse (estado: ${entry.status})`);
    return entry;
  }
}
