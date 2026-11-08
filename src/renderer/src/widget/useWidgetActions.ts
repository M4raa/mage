import { useCallback, useRef, useState } from 'react';
import type { MageApi } from '@shared/ipc';
import type { WidgetChoice } from '@shared/widget';
import { rowTarget, type WidgetRow } from './widgetModel';

type ActionsClient = Pick<MageApi, 'answerFromWidget' | 'interruptFromWidget' | 'openSessionFromWidget' | 'activateWidgetTab'>;

export interface WidgetActions {
  readonly busy: ReadonlySet<string>; // requestIds y `stop:<sessionId>` en vuelo
  readonly late: ReadonlySet<string>; // requestIds rechazados por ya contestados
  readonly failed: ReadonlySet<string>; // requestIds cuya respuesta lanzó
  readonly stopFailed: ReadonlySet<string>; // sessionIds cuyo Detener lanzó
  readonly answer: (sessionId: string, requestId: string, choice: WidgetChoice) => void;
  readonly stop: (sessionId: string) => void;
  readonly open: (row: WidgetRow) => void;
  readonly forgetResolved: (liveRequestIds: ReadonlySet<string>) => void;
}

const addTo = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => new Set(set).add(key);

const keepLive = (set: ReadonlySet<string>, live: ReadonlySet<string>): ReadonlySet<string> => {
  const kept = [...set].filter((id) => live.has(id));
  return kept.length === set.size ? set : new Set(kept);
};

// Acciones del widget sobre las sesiones. La respuesta es única: el doble clic no sale dos veces y la
// tardía (otra vista contestó antes) se dice en vez de fallar.
export function useWidgetActions(mage: ActionsClient): WidgetActions {
  const inFlight = useRef<Set<string>>(new Set()); // evita el doble clic antes de que React repinte
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [late, setLate] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [stopFailed, setStopFailed] = useState<ReadonlySet<string>>(new Set());

  // Ejecuta `run` marcando `key` como en vuelo; el resultado o el error los decide el llamador.
  const guarded = useCallback(async (key: string, run: () => Promise<void>): Promise<void> => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusy((prev) => addTo(prev, key));
    try {
      await run();
    } finally {
      inFlight.current.delete(key);
      setBusy((prev) => new Set([...prev].filter((k) => k !== key)));
    }
  }, []);

  const answer = useCallback(
    (sessionId: string, requestId: string, choice: WidgetChoice): void => {
      void guarded(requestId, async () => {
        try {
          const receipt = await mage.answerFromWidget({ sessionId, requestId, choice });
          if (receipt.status === 'rejected') setLate((prev) => addTo(prev, requestId));
        } catch (err) {
          console.error('[widget] no se pudo contestar', err);
          setFailed((prev) => addTo(prev, requestId));
        }
      });
    },
    [mage, guarded],
  );

  const stop = useCallback(
    (sessionId: string): void => {
      void guarded(`stop:${sessionId}`, async () => {
        try {
          await mage.interruptFromWidget(sessionId);
        } catch (err) {
          console.error('[widget] no se pudo detener', err);
          setStopFailed((prev) => addTo(prev, sessionId));
        }
      });
    },
    [mage, guarded],
  );

  const open = useCallback(
    (row: WidgetRow): void => {
      const target = rowTarget(row);
      if (target === null) return;
      if (target.kind === 'session') mage.openSessionFromWidget(target.sessionId);
      else mage.activateWidgetTab(target.tabId);
    },
    [mage],
  );

  const forgetResolved = useCallback((live: ReadonlySet<string>): void => {
    setLate((prev) => keepLive(prev, live));
    setFailed((prev) => keepLive(prev, live));
  }, []);

  return { busy, late, failed, stopFailed, answer, stop, open, forgetResolved };
}
