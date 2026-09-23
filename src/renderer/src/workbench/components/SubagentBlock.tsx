import { useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { SubagentTranscriptView } from './SubagentTranscriptView';
import type { Block } from '../types';

// Bloque de SUBAGENTE en el hilo (2.5). Antes un `Task`/`Agent` se pintaba como una tool mas, con su
// input resumido y nada del trabajo que hizo dentro.
//
// El boton de la transcripcion reutiliza `SubagentTranscriptView` TAL CUAL (ya existia para el panel de
// Logs); se deshabilita mientras no haya `agentId`, que es lo unico con lo que se puede localizar el
// fichero `agent-<id>.jsonl`: un boton que abre un overlay vacio seria peor que uno apagado.
export function SubagentBlock({ block }: { readonly block: Extract<Block, { kind: 'subagent' }> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const sessionId = useWorkbenchStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return s.sessionIdByChat[s.activeTabId] ?? active?.resumeSessionId;
  });
  // Config dir EFECTIVO (en una conversacion privada, su perfil `mage-private`): con el de la cuenta se
  // buscaria la transcripcion del subagente donde no esta.
  const accountDir = tab === undefined ? '' : (tab.resolvedConfigDir ?? tab.accountId);
  const canOpen = block.agentId !== null && tab !== undefined && sessionId !== undefined;

  return (
    <div className="flex justify-start">
      <div className="flex min-w-0 max-w-[92%] flex-col gap-[6px] rounded-[10px] border border-mg-sel bg-mg-block p-[9px_13px]">
        <div className="flex items-center gap-[8px] text-[11.5px]">
          <span aria-hidden="true" className="text-mg-ter">⇲</span>
          <span className="font-bold text-mg-text">{block.agentType ?? 'Subagente'}</span>
          {block.status !== null && (
            <span className={`text-[10.5px] ${block.status === 'error' ? 'text-mg-danger' : 'text-mg-ter'}`}>{block.status}</span>
          )}
        </div>
        {block.description !== null && (
          <div className="min-w-0 break-words text-[11.5px] leading-[1.5] text-mg-sec2">{block.description}</div>
        )}
        <button
          onClick={() => setOpen(true)}
          disabled={!canOpen}
          data-tip={canOpen ? 'Ver lo que hizo el subagente' : 'Aún no ha reportado su identificador'}
          className="w-fit rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-40"
        >
          Ver transcripción
        </button>
      </div>
      {open && canOpen && block.agentId !== null && tab !== undefined && sessionId !== undefined && (
        <SubagentTranscriptView
          accountDir={accountDir}
          cwd={tab.cwd}
          sessionId={sessionId}
          // `entryIndex` es para anclar la fila dentro del panel de Logs; desde el hilo no hay linea de
          // transcripcion a la que volver, asi que va a -1 (y el overlay no lo usa para abrir nada).
          subagent={{
            toolUseId: block.toolUseId,
            entryIndex: -1,
            agentType: block.agentType,
            description: block.description,
            agentId: block.agentId,
            status: block.status,
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
