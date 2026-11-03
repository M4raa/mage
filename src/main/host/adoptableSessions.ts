import type { AdoptableSession } from '@shared/ipc';

// Registro de las sesiones del host (terminal, MCP) que la ventana principal puede adoptar como pestaña (U17).
// Guarda solo lo ESTÁTICO de cada una (cómo se lanzó); los ids de conversación y de transcripción cambian
// durante la vida de la sesión, así que salen del coordinador cada vez que se lista. Sin E/S: quien lo usa
// le inyecta esa consulta, y una sesión que el coordinador ya no sigue se borra al listar.

export type AdoptableEntry = Omit<AdoptableSession, 'conversationId' | 'nativeId'>;

export interface LiveSessionIds {
  readonly conversationId: string | null;
  readonly nativeId: string | null;
}

export class AdoptableSessions {
  // Un Map conserva el orden de alta y da acceso O(1).
  private readonly entries = new Map<string, AdoptableEntry>();

  add(entry: AdoptableEntry): void {
    if (this.entries.has(entry.sessionId)) throw new Error(`AdoptableSessions: la sesión ${entry.sessionId} ya está registrada`);
    this.entries.set(entry.sessionId, entry);
  }

  remove(sessionId: string): boolean {
    return this.entries.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  list(live: (sessionId: string) => LiveSessionIds | null): readonly AdoptableSession[] {
    const result: AdoptableSession[] = [];
    for (const [sessionId, entry] of [...this.entries]) {
      const ids = live(sessionId);
      if (ids === null) this.entries.delete(sessionId);
      else result.push({ ...entry, ...ids });
    }
    return result;
  }
}
