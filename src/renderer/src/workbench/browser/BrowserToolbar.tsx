import { useState } from 'react';
import { zoomStepForKey, type BrowserEntryState, type BrowserZoomStep } from '@shared/browser';
import { useT } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';
import { Icon, type IconName } from '../components/Icon';

// Barra de direcciones del navegador de Mage. La misma en el panel y en su ventana propia: lo que no existe en un
// sitio (la pluma fuera del chat) llega sin su callback y no se pinta.
const ICON_BUTTON = 'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body disabled:opacity-40';
const ZOOM_LABEL = 'h-[22px] shrink-0 rounded-[6px] px-[4px] font-mono text-[10px] text-mg-muted hover:bg-mg-hover hover:text-mg-body';

interface ToolButtonProps {
  readonly icon: IconName;
  readonly label: string;
  readonly disabled?: boolean;
  readonly flip?: boolean;
  readonly dataAttr?: Readonly<Record<string, string>>;
  readonly onClick: () => void;
}

function ToolButton({ icon, label, disabled, flip, dataAttr, onClick }: ToolButtonProps): React.JSX.Element {
  return (
    <button title={label} aria-label={label} disabled={disabled} onClick={onClick} className={ICON_BUTTON} {...dataAttr}>
      <Icon name={icon} size={13} className={flip === true ? 'rotate-180' : ''} />
    </button>
  );
}

export interface BrowserToolbarProps {
  readonly sessionId: string;
  readonly state: BrowserEntryState | null;
  readonly onError: (message: string | null) => void;
  readonly onPen?: () => void;
  readonly onPopOut?: () => void;
}

type Run = (action: Promise<unknown>) => void;

function onEnter(e: React.KeyboardEvent, typed: string | null, submit: (url: string) => void): void {
  if (e.key !== 'Enter' || typed === null || typed.trim() === '') return;
  submit(typed.trim());
}

function AddressInput({ sessionId, state, run }: { readonly sessionId: string; readonly state: BrowserEntryState | null; readonly run: Run }): React.JSX.Element {
  const t = useT();
  const [typed, setTyped] = useState<string | null>(null);
  const submit = (url: string): void => {
    setTyped(null);
    run(window.mage.browserNavigate({ sessionId, url }));
  };
  return (
    <input
      data-browser-address
      aria-label={t('chat.browser.address')}
      value={typed ?? state?.url ?? ''}
      onFocus={() => setTyped(state?.url ?? '')}
      onBlur={() => setTyped(null)}
      onChange={(e) => setTyped(e.target.value)}
      onKeyDown={(e) => onEnter(e, typed, submit)}
      spellCheck={false}
      className="min-w-[120px] flex-1 basis-[160px] rounded-[6px] border border-mg-border-ctrl bg-transparent px-[8px] py-[3px] font-mono text-[10.5px] text-mg-body"
    />
  );
}

function ZoomControls({ state, zoom }: { readonly state: BrowserEntryState; readonly zoom: (step: BrowserZoomStep) => void }): React.JSX.Element {
  const t = useT();
  const reset = t('chat.browser.zoomReset', { percent: state.zoomPercent });
  return (
    <>
      <ToolButton icon="minus" label={t('chat.browser.zoomOut')} dataAttr={{ 'data-browser-zoom-out': '' }} onClick={() => zoom(-1)} />
      <button title={reset} aria-label={reset} onClick={() => zoom(0)} className={ZOOM_LABEL} data-browser-zoom-reset={state.zoomPercent}>
        {`${state.zoomPercent} %`}
      </button>
      <ToolButton icon="plus" label={t('chat.browser.zoomIn')} dataAttr={{ 'data-browser-zoom-in': '' }} onClick={() => zoom(1)} />
    </>
  );
}

interface ActionsProps {
  readonly sessionId: string;
  readonly state: BrowserEntryState;
  readonly run: Run;
  readonly onPen?: () => void;
  readonly onPopOut?: () => void;
}

// A la derecha de la dirección: copiar, abrir fuera, zoom, ventana propia, la pluma, herramientas de desarrollo y cerrar.
function PageActions({ sessionId, state, run, onPen, onPopOut }: ActionsProps): React.JSX.Element {
  const t = useT();
  const zoom = (step: BrowserZoomStep): void => run(window.mage.browserZoom({ sessionId, step }));
  return (
    // Un solo grupo: si no cabe junto a la dirección, baja entero a la fila siguiente, pegado a la derecha.
    <div className="ml-auto flex shrink-0 items-center gap-[4px]">
      <ToolButton icon="copy" label={t('chat.browser.copyAddress')} dataAttr={{ 'data-browser-copy': '' }} onClick={() => run(navigator.clipboard.writeText(state.url))} />
      <ToolButton icon="external" label={t('chat.browser.openExternal')} dataAttr={{ 'data-browser-open-external': '' }} onClick={() => run(window.mage.browserOpenExternal(sessionId))} />
      <ZoomControls state={state} zoom={zoom} />
      {onPopOut !== undefined && <ToolButton icon="newWindow" label={t('chat.browser.popOut')} dataAttr={{ 'data-browser-pop-out': '' }} onClick={onPopOut} />}
      {onPen !== undefined && <ToolButton icon="pencil" label={t('chat.browser.pen')} dataAttr={{ 'data-browser-pen-button': '' }} onClick={onPen} />}
      {/* Sin empaquetar lo dice main (`--mage-development`), no `import.meta.env`. */}
      {window.mage.isDevelopment && <ToolButton icon="panelCommands" label={t('chat.browser.devTools')} dataAttr={{ 'data-browser-devtools': '' }} onClick={() => run(window.mage.browserDevTools(sessionId))} />}
      <ToolButton icon="close" label={t('chat.browser.close')} dataAttr={{ 'data-browser-close': '' }} onClick={() => run(window.mage.browserClose(sessionId))} />
    </div>
  );
}

export function BrowserToolbar({ sessionId, state, onError, onPen, onPopOut }: BrowserToolbarProps): React.JSX.Element {
  const t = useT();
  const run: Run = (action) => {
    onError(null);
    action.catch((err: unknown) => onError(describeError(err)));
  };
  // Ctrl/Cmd + `+`, `-`, `0` con el foco en la barra: el zoom de la página (con el foco en la página lo atrapa main).
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = state === null ? null : zoomStepForKey({ key: e.key, control: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    if (step === null) return;
    e.preventDefault();
    run(window.mage.browserZoom({ sessionId, step }));
  };
  return (
    // `flex-wrap`: en un panel estrecho los botones de la derecha bajan a otra fila en vez de aplastar la dirección.
    <div data-browser-toolbar onKeyDown={onKeyDown} className="flex shrink-0 flex-wrap items-center gap-[4px] border-b border-mg-border-subtle px-[8px] py-[5px]">
      <ToolButton icon="chevron" flip label={t('chat.browser.back')} disabled={state?.canGoBack !== true} dataAttr={{ 'data-browser-back': '' }} onClick={() => run(window.mage.browserBack(sessionId))} />
      <ToolButton icon="chevron" label={t('chat.browser.forward')} disabled={state?.canGoForward !== true} dataAttr={{ 'data-browser-forward': '' }} onClick={() => run(window.mage.browserForward(sessionId))} />
      <ToolButton icon="refresh" label={t('chat.browser.reload')} disabled={state === null} onClick={() => run(window.mage.browserReload(sessionId))} />
      <AddressInput sessionId={sessionId} state={state} run={run} />
      {state !== null && <PageActions sessionId={sessionId} state={state} run={run} onPen={onPen} onPopOut={onPopOut} />}
    </div>
  );
}
