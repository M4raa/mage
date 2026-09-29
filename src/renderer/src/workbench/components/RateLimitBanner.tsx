import { useState } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { autoContinueBlockedReason, effectiveResetMs, rateLimitLineText } from '../rateLimit';

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
  const setAutoContinue = useWorkbenchStore((s) => s.setRateLimitAutoContinue);
  const usage = useWorkbenchStore((s) => s.usageByAccount[s.tabs.find((t) => t.id === tabId)?.accountId ?? '']);
  const [moving, setMoving] = useState(false);

  if (notice === undefined || tab === undefined) return null;
  const resetsAtMs = effectiveResetMs(notice, usage);
  const autoBlockedReason = autoContinueBlockedReason(resetsAtMs, Date.now());
  // Solo cuentas CON login: mudarse a una desconectada cambia "no puedes escribir" por "no puedes
  // escribir, y ademas ahora estas en otro sitio".
  const targets = accounts.filter((a) => a.id !== tab.accountId && a.loginStatus === 'logged_in');

  return (
    <div
      role="status"
      className="mx-[10px] mb-[6px] flex flex-wrap items-center gap-[8px] rounded-[9px] border border-mg-warn-border bg-mg-warn-bg p-[8px_11px] text-[11.5px] text-mg-body"
    >
      {/* El mismo texto de Mage que la linea del hilo; el del CLI, en ingles, en el tooltip (P-028, 20). */}
      <span className="min-w-0 flex-1" {...(notice.summary.length === 0 ? {} : { 'data-tip': notice.summary })}>
        <Icon name="hourglass" size={12} /> {rateLimitLineText(resetsAtMs)}
      </span>
      <label
        className={`inline-flex items-center gap-[5px] text-mg-body2 ${autoBlockedReason === null ? '' : 'opacity-50'}`}
        {...(autoBlockedReason === null ? {} : { 'data-tip': autoBlockedReason })}
      >
        <input
          type="checkbox"
          checked={notice.autoContinue === true}
          disabled={autoBlockedReason !== null}
          onChange={(e) => setAutoContinue(tabId, e.target.checked)}
        />
        Continuar al restablecerse
      </label>
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
                continueInAccount(tabId, account.id)
                  .catch((err: unknown) => console.error('No se pudo continuar en la otra cuenta:', err instanceof Error ? err.message : String(err)))
                  .finally(() => setMoving(false));
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
