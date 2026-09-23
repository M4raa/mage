import { useEffect, useState } from 'react';
import { List } from 'react-window';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTranscriptStore } from '../paneContext';
import { useActiveTranscriptSessionId } from '../useActiveTranscript';
import { TranscriptRow } from './TranscriptRow';
import { Hint } from './TranscriptHint';
import { ToolCallDetail, toolDetailFor } from './ToolCallDetail';

const ROW_HEIGHT_PX = 28;

// Panel "Logs" del Inspector: renderiza en una lista virtualizada (react-window) la transcripcion
// persistida ya cargada por el transcriptStore. PRESENTACION PURA: el ciclo de vida de la lectura vive
// en `useTranscriptLifecycle` (Fase C), no aqui.
//
// Ya NO lista los subagentes: esa mitad se movio al panel "Subagentes" (2.9.b), que es donde el usuario
// los busca — aqui estaban escondidos dentro del panel de Logs.
export function TranscriptLogPanel(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  // La sesion a MOSTRAR, no la viva (ver `useActiveTranscript.ts`): una conversacion abierta del
  // historial tiene su .jsonl entero en disco y ninguna sesion viva hasta el primer mensaje.
  const sessionId = useActiveTranscriptSessionId();
  // 4.1: el store de la pestaña ACTIVA (este panel vive fuera del centro, asi que `usePaneTabId`
  // devuelve la activa). Decision del usuario: los paneles globales siguen a la pestaña activa.
  const useTranscriptStore = usePaneTranscriptStore();
  const entries = useTranscriptStore((s) => s.entries);
  const errorMessage = useTranscriptStore((s) => s.errorMessage);
  const isFinal = useTranscriptStore((s) => s.isFinal);
  const totalLinesSoFar = useTranscriptStore((s) => s.totalLinesSoFar);
  const refresh = useTranscriptStore((s) => s.refresh);
  // Linea seleccionada, cuyo detalle se pinta debajo. Es del PANEL y no de la fila: la fila se
  // desmonta al scrollear (la lista es virtualizada), y con el estado dentro se perdia el detalle al
  // alejarse de ella.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Al cambiar de conversacion, el indice de antes apunta a otra linea distinta (o a ninguna): se
  // suelta en vez de enseñar el detalle equivocado.
  useEffect(() => setSelectedIndex(null), [sessionId]);

  if (tab === undefined || sessionId === undefined) {
    return <Hint text="Abre una conversación para ver sus registros." />;
  }
  if (errorMessage !== null) {
    return <Hint text={`No se pudo leer la transcripción: ${errorMessage}`} onRetry={refresh} />;
  }
  if (entries.length === 0) {
    return <Hint text={isFinal ? 'Transcripción vacía.' : 'Cargando transcripción…'} onRetry={refresh} />;
  }

  const selected = selectedIndex === null ? undefined : entries[selectedIndex];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* La lista se queda con la mitad de arriba cuando hay detalle abierto, y con todo cuando no. Es
          un `flex-1` con `min-h-0`: sin el segundo, un hijo flex se niega a bajar de la altura de su
          contenido y la lista empujaria al detalle fuera del panel. */}
      <div className="min-h-0 flex-1">
        <List
          rowComponent={TranscriptRow}
          rowCount={entries.length}
          rowHeight={ROW_HEIGHT_PX}
          rowProps={{ entries, selectedIndex, onSelect: (index) => setSelectedIndex((current) => (current === index ? null : index)) }}
          style={{ height: '100%' }}
        />
      </div>

      {selected !== undefined && (
        // Detalle de la linea seleccionada, en su PROPIA seccion bajo la lista. Aqui y no dentro de la
        // fila porque las filas de react-window son hermanas absolutas de altura fija: un desplegable
        // dentro de una de ellas se entremezcla con el texto de las siguientes en vez de taparlas, que
        // es justo lo que reporto el usuario con dos capturas.
        <div className="flex min-h-0 shrink-0 basis-1/2 flex-col border-t border-mg-border bg-mg-code">
          <div className="flex shrink-0 items-center justify-between gap-[8px] border-b border-mg-border-subtle px-[10px] py-[5px] text-[10px] text-mg-ter">
            <span className="truncate font-mono">
              Línea {selected.index + 1} · {selected.kind}
            </span>
            <button
              onClick={() => setSelectedIndex(null)}
              aria-label="Cerrar el detalle de la línea"
              data-tip="Cerrar el detalle"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-mg-muted hover:text-mg-body"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-[8px] text-[10px]">
            {toolDetailFor(selected) !== null ? (
              <>
                <ToolCallDetail entry={selected} />
                <details className="mt-[8px]">
                  <summary className="cursor-pointer text-mg-muted hover:text-mg-body">JSON crudo</summary>
                  <pre className="mt-[4px] whitespace-pre-wrap break-all font-mono text-mg-sec">{JSON.stringify(selected.raw, null, 2)}</pre>
                </details>
              </>
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-mg-sec">{JSON.stringify(selected.raw, null, 2)}</pre>
            )}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-t border-mg-border-subtle px-[10px] py-[5px] text-[10px] text-mg-ter">
        <span>
          {totalLinesSoFar} líneas{!isFinal ? ' (cargando…)' : ''}
        </span>
        <button onClick={refresh} data-tip="Releer transcripción" className="flex h-4 w-4 items-center justify-center rounded-[4px] text-mg-muted hover:text-mg-body">
          ⟳
        </button>
      </div>
    </div>
  );
}

