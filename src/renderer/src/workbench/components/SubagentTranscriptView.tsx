import { useEffect, useState } from 'react';
import { List } from 'react-window';
import { useSubagentTranscriptStore } from '../transcriptStore';
import type { SubagentInvocation } from '../subagentView';
import { TranscriptRow } from './TranscriptRow';
import { Hint } from './TranscriptHint';

const ROW_HEIGHT_PX = 28;

export interface SubagentTranscriptViewProps {
  readonly accountDir: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly subagent: SubagentInvocation; // el clicado; su agentId identifica el fichero a abrir
  readonly onClose: () => void;
}

// Overlay de drill-down (M2.2.3b): abre el transcript del subagente `agent-<agentId>.jsonl` en un
// store DEDICADO (no pisa el principal) y lo muestra con la MISMA lista virtualizada que Logs. El
// contenido de la fila (tool calls, diffs, JSON crudo) se reutiliza tal cual: el formato de linea del
// subagente es identico al del transcript principal.
export function SubagentTranscriptView({ accountDir, cwd, sessionId, subagent, onClose }: SubagentTranscriptViewProps): React.JSX.Element {
  const open = useSubagentTranscriptStore((s) => s.open);
  const cancel = useSubagentTranscriptStore((s) => s.cancel);
  const refresh = useSubagentTranscriptStore((s) => s.refresh);
  const entries = useSubagentTranscriptStore((s) => s.entries);
  const errorMessage = useSubagentTranscriptStore((s) => s.errorMessage);
  const isFinal = useSubagentTranscriptStore((s) => s.isFinal);
  const totalLinesSoFar = useSubagentTranscriptStore((s) => s.totalLinesSoFar);

  const agentId = subagent.agentId;

  useEffect(() => {
    // agentId nunca es null aqui (la fila no es clicable sin el), pero el guard mantiene el contrato.
    if (agentId === null) return;
    void open({ accountDir, cwd, sessionId, agentId });
    return () => cancel();
    // Reabre solo si cambia el subagente a mostrar (o su sesion/cuenta de origen).
  }, [accountDir, cwd, sessionId, agentId, open, cancel]);

  // Accesibilidad (M3): Escape vuelve a la conversacion principal (no es un modal, no atrapa el foco).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div data-subagent-transcript="true" className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-mg-panel">
      <div className="flex shrink-0 items-center gap-[8px] border-b border-mg-border-subtle px-[10px] py-[6px]">
        <button onClick={onClose} className="shrink-0 rounded-[4px] px-[6px] py-[2px] text-[11px] text-mg-body2 hover:bg-mg-hover" data-tip="Volver a la conversación principal">
          ◂ Volver
        </button>
        <span className="shrink-0 rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9px] text-mg-body">{subagent.agentType ?? 'agente'}</span>
        <span className="truncate text-[10.5px] text-mg-sec">{subagent.description ?? '(sin descripción)'}</span>
      </div>
      {/* `min-h-0`: sin el, la lista (height:100%) crece al total de filas y se sale de la capa (punto 39). */}
      <div className="min-h-0 flex-1">
        <Body entries={entries} errorMessage={errorMessage} isFinal={isFinal} onRetry={refresh} />
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-mg-border-subtle px-[10px] py-[5px] text-[10px] text-mg-ter">
        <span>
          {totalLinesSoFar} líneas{!isFinal ? ' (cargando…)' : ''}
        </span>
        <button onClick={refresh} data-tip="Releer transcripción del subagente" className="flex h-4 w-4 items-center justify-center rounded-[4px] text-mg-muted hover:text-mg-body">
          ⟳
        </button>
      </div>
    </div>
  );
}

function Body({
  entries,
  errorMessage,
  isFinal,
  onRetry,
}: {
  readonly entries: ReturnType<typeof useSubagentTranscriptStore.getState>['entries'];
  readonly errorMessage: string | null;
  readonly isFinal: boolean;
  readonly onRetry: () => void;
}): React.JSX.Element {
  // Misma seleccion que el panel de Logs, y por el mismo motivo: la fila SELECCIONA y el detalle se
  // pinta aparte, porque las filas de react-window son hermanas absolutas y un desplegable dentro de
  // una de ellas se entremezcla con las siguientes.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  if (errorMessage !== null) return <Hint text={`No se pudo leer el subagente: ${errorMessage}`} onRetry={onRetry} />;
  if (entries.length === 0) return <Hint text={isFinal ? 'Transcripción del subagente vacía.' : 'Cargando subagente…'} onRetry={onRetry} />;
  const selected = selectedIndex === null ? undefined : entries[selectedIndex];
  return (
    <div className="flex h-full min-h-0 flex-col">
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
        <div className="min-h-0 shrink-0 basis-1/2 overflow-auto border-t border-mg-border bg-mg-code p-[8px] text-[10px]">
          <pre className="whitespace-pre-wrap break-all font-mono text-mg-sec">{JSON.stringify(selected.raw, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
