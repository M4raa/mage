import { useState } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { formatResetTime } from '../usageView';

// Salida cuando se agota el uso (H4, punto del usuario: "al acabarse el uso en un chat activo tiene
// que aparecer una opcion de continuar el chat en otra cuenta").
//
// Va entre el hilo y el prompt, y no dentro del hilo, a proposito: el hilo es el RELATO (ahi ya esta la
// linea "⏳ Limite de uso alcanzado" que pone `cliNotices`) y esto es una ACCION sobre el estado de
// ahora. Metida como bloque se iria hacia arriba con el scroll justo cuando hace falta.
export function RateLimitBanner(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const notice = useWorkbenchStore((s) => s.rateLimitByChat[tabId]);
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const accounts = useWorkbenchStore((s) => s.accounts);
  const continueInAccount = useWorkbenchStore((s) => s.continueInAccount);
  const [moving, setMoving] = useState(false);

  if (notice === undefined || tab === undefined) return null;
  // Solo cuentas CON login: mudarse a una desconectada cambia "no puedes escribir" por "no puedes
  // escribir, y ademas ahora estas en otro sitio".
  const targets = accounts.filter((a) => a.id !== tab.accountId && a.loginStatus === 'logged_in');

  return (
    <div
      role="status"
      className="mx-[10px] mb-[6px] flex flex-wrap items-center gap-[8px] rounded-[9px] border border-mg-warn-border bg-mg-warn-bg p-[8px_11px] text-[11.5px] text-mg-body"
    >
      <span className="min-w-0 flex-1">
        <Icon name="hourglass" size={12} /> {notice.summary.trim().length === 0 ? 'Se agotó el uso de esta cuenta.' : notice.summary.trim()}
        {/* El texto del CLI YA suele decir cuando se restablece ("resets 3pm"), asi que la cuenta atras
            solo se anade cuando NO hay texto: si no, se diria dos veces y con dos formatos distintos.
            El `resetsAt` viene del stream (9.3, medido en S3); antes siempre era null. */}
        {notice.summary.trim().length === 0 && notice.resetsAtMs !== null && (
          <span className="text-mg-muted"> Se restablece a las {formatResetTime(notice.resetsAtMs)}.</span>
        )}
      </span>
      {targets.length === 0 ? (
        // Sin destino no se ofrece un boton muerto: se dice por que no lo hay.
        <span className="text-mg-muted">No hay otra cuenta con sesión iniciada.</span>
      ) : (
        <>
          <span className="text-mg-muted">Continuar en:</span>
          {targets.map((account) => (
            <button
              key={account.id}
              disabled={moving}
              onClick={() => {
                setMoving(true);
                void continueInAccount(tabId, account.id).finally(() => setMoving(false));
              }}
              className="inline-flex items-center gap-[6px] rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-mg-body transition-colors duration-150 ease-out hover:bg-mg-hover disabled:opacity-50"
            >
              <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: account.accent.base }} />
              <span className="truncate">{account.alias}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
