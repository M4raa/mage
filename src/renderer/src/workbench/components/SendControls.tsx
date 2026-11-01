import { useState } from 'react';
import type { SendNowAvailability } from '../sendNow';
import { renderLocalized } from '@shared/i18n/localizedText';
import { Icon } from './Icon';
import { useT } from '../../i18n/uiLanguage';

// Controles de envío de la barra (G-U1, F4.1): sin turno, el ⏎ de siempre; con turno, «Parar» y el botón
// dividido «A la cola ▾ Enviar ahora». La decisión de a dónde va el mensaje es de main: aquí solo se elige el modo.
export interface SendControlsProps {
  readonly running: boolean;
  readonly canInterrupt: boolean;
  readonly canSend: boolean;
  readonly sendNow: SendNowAvailability;
  // Atajos efectivos para los textos (null si el usuario dejó la acción sin atajo).
  readonly queueKeys: string | null;
  readonly sendNowKeys: string | null;
  readonly onSend: () => void;
  readonly onSendNow: () => void;
  readonly onInterrupt: () => void;
}

export function SendControls(props: SendControlsProps): React.JSX.Element {
  if (!props.running) return <SendButton canSend={props.canSend} onSend={props.onSend} />;
  return (
    <>
      {props.canInterrupt && <StopButton onInterrupt={props.onInterrupt} />}
      <SplitSend {...props} />
    </>
  );
}

// Parar la acción en curso (B3): interrumpe el turno (control_request interrupt). El CLI
// cierra el turno con su `result` y el chat vuelve a 'idle'.
function StopButton({ onInterrupt }: { readonly onInterrupt: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <button
      onClick={onInterrupt}
      data-tip={t('prompt.stop.tip')}
      aria-label={t('prompt.stop.ariaLabel')}
      className="shrink-0 cursor-pointer self-center rounded-full border border-mg-danger-border bg-mg-danger-bg px-[9px] py-[2px] text-[10.5px] font-semibold text-mg-danger hover:opacity-90"
    >
      <Icon name="stop" size={11} /> {t('prompt.stop.button')}
    </button>
  );
}

// #24: era un ⏎ decorativo. Ahora envía con la MISMA acción que Enter (sendFromButton).
function SendButton({ canSend, onSend }: { readonly canSend: boolean; readonly onSend: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <button
      onClick={onSend}
      disabled={!canSend}
      aria-label={t('prompt.send.ariaLabel')}
      data-tip={t('prompt.send.tip')}
      className="shrink-0 cursor-pointer self-center rounded-full border border-mg-border-ctrl px-[8px] py-[1px] font-mono text-[10.5px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover disabled:cursor-default disabled:text-mg-muted disabled:opacity-60 disabled:hover:bg-transparent"
    >
      ⏎
    </button>
  );
}

// Mismas clases que el ⏎; cada mitad pone sus esquinas y su relleno.
const SPLIT_BUTTON_CLASS =
  'cursor-pointer border border-mg-border-ctrl py-[1px] text-[10.5px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover disabled:cursor-default disabled:text-mg-muted disabled:opacity-60 disabled:hover:bg-transparent';

function SplitSend(props: SendControlsProps): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sendNow = (): void => {
    setOpen(false);
    props.onSendNow();
  };
  const menuTip = t('prompt.sendMenu.ariaLabel');
  return (
    <div className="relative flex shrink-0 self-center" data-send-split="true" onKeyDown={(e) => e.key === 'Escape' && open && setOpen(false)}>
      <button
        data-send-queue="true"
        onClick={props.onSend}
        disabled={!props.canSend}
        aria-label={t('prompt.queueSend.button')}
        data-tip={t('prompt.queueSend.tip', { keys: props.queueKeys ?? '' })}
        className={`${SPLIT_BUTTON_CLASS} rounded-l-full px-[9px]`}
      >
        {t('prompt.queueSend.button')}
      </button>
      <button
        data-send-menu="true"
        onClick={() => setOpen((v) => !v)}
        aria-label={menuTip}
        data-tip={menuTip}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${SPLIT_BUTTON_CLASS} rounded-r-full border-l-0 px-[5px]`}
      >
        <Icon name="chevron" size={9} className="rotate-90" />
      </button>
      {open && <SendNowMenu {...props} onClose={() => setOpen(false)} onPick={sendNow} />}
    </div>
  );
}

// Menú hacia ARRIBA (la barra está abajo), con el mismo cierre al pulsar fuera que el menú «⋯».
function SendNowMenu(props: SendControlsProps & { readonly onClose: () => void; readonly onPick: () => void }): React.JSX.Element {
  const t = useT();
  const enabled = props.canSend && props.sendNow.enabled;
  const tip = props.sendNow.enabled ? t('prompt.sendNow.tip', { keys: props.sendNowKeys ?? '' }) : renderLocalized(t, props.sendNow.reason);
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={props.onClose} />
      <div role="menu" className="absolute bottom-full right-0 z-20 mb-[6px] w-[190px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-panel py-[4px] mg-shadow-pop">
        <button
          role="menuitem"
          data-send-now="true"
          onClick={props.onPick}
          disabled={!enabled}
          data-tip={tip}
          className="flex w-full items-center gap-[9px] px-[11px] py-[6px] text-left text-[11.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {t('prompt.sendNow.label')}
          {props.sendNowKeys !== null && <span className="ml-auto text-[10px] text-mg-muted">{props.sendNowKeys}</span>}
        </button>
      </div>
    </>
  );
}
