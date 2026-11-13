import { useWorkbenchStore } from './workbenchStore';
import { decideIdleClose, idleFactsOf, IDLE_SWEEP_INTERVAL_MS } from './idleSessions';

// Punto 23 de P-043 (D2): barrido de las pestañas con proceso vivo de ESTA ventana. Vive en el renderer porque la
// visibilidad (hojas y pestaña activa) solo la conoce el store de cada ventana, y soltar el proceso dejando la pestaña
// (y reanudar al escribir, con `--resume`) ya son flujos de aquí. Main solo dice lo que solo sabe él (`getSessionIdleState`).
const firstSeenBySession = new Map<string, number>();

export async function sweepIdleSessions(nowMs: number, tabIds?: readonly string[]): Promise<readonly string[]> {
  const state = useWorkbenchStore.getState();
  pruneFirstSeen(new Set(Object.values(state.sessionIdByChat)));
  const closed: string[] = [];
  for (const tabId of tabIds ?? Object.keys(state.sessionIdByChat)) {
    const sessionId = state.sessionIdByChat[tabId];
    if (sessionId === undefined) continue;
    if (!firstSeenBySession.has(sessionId)) firstSeenBySession.set(sessionId, nowMs);
    const facts = idleFactsOf(state, tabId, firstSeenBySession.get(sessionId) ?? nowMs);
    if (decideIdleClose(facts, state.settings.idleCloseMinutes, nowMs).kind !== 'close') continue;
    if (!(await mainAllowsClose(sessionId))) continue;
    await useWorkbenchStore.getState().releaseIdleSession(tabId);
    closed.push(tabId);
  }
  return closed;
}

function pruneFirstSeen(live: ReadonlySet<string>): void {
  for (const sessionId of [...firstSeenBySession.keys()]) {
    if (!live.has(sessionId)) firstSeenBySession.delete(sessionId);
  }
}

// Sin respuesta de main no se suelta nada: se traza y se deja como está.
async function mainAllowsClose(sessionId: string): Promise<boolean> {
  try {
    const idle = await window.mage.getSessionIdleState(sessionId);
    return !idle.keepAliveActive && idle.otherClients === 0;
  } catch (err) {
    console.warn(`Inactividad: no se pudo leer el estado de ${sessionId}; no se suelta`, err);
    return false;
  }
}

export function startIdleSessionCloser(): () => void {
  const timer = window.setInterval(() => {
    void sweepIdleSessions(Date.now()).catch((err: unknown) => console.warn('Inactividad: el barrido falló', err));
  }, IDLE_SWEEP_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
