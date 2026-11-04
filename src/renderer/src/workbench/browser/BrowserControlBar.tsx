import { useState } from 'react';
import type { BrowserEntryState } from '@shared/browser';
import { useT } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';
import { Icon } from '../components/Icon';

// Barra de control del navegador (I3): dice quién lleva la pestaña y deja quitársela al agente (Detener) o devolvérsela.
// Detener siempre está a la vista mientras el agente controla (P-S2).
const BAR = 'flex shrink-0 items-center gap-[8px] border-b border-mg-border-subtle px-[10px] py-[5px] text-[10.5px] text-mg-body2';
const ACTION = 'flex items-center gap-[4px] rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover hover:text-mg-body disabled:opacity-50';

export function BrowserControlBar({ state }: { readonly state: BrowserEntryState }): React.JSX.Element | null {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  if (state.control === 'idle') return null;
  const agent = state.control === 'agent';
  const run = (action: (sessionId: string) => Promise<void>): void => {
    setError(null);
    action(state.sessionId).catch((err: unknown) => setError(describeError(err)));
  };
  return (
    <div className="flex shrink-0 flex-col">
      <div role="status" data-browser-control-bar={state.control} className={BAR}>
        <span className="min-w-0 flex-1 truncate">{t(agent ? 'chat.browser.agentControlling' : 'chat.browser.userControlling')}</span>
        {agent ? (
          <button data-browser-stop onClick={() => run((id) => window.mage.browserTakeControl(id))} className={ACTION}>
            <Icon name="stop" size={12} />
            {t('chat.browser.stop')}
          </button>
        ) : (
          <button data-browser-return onClick={() => run((id) => window.mage.browserReturnControl(id))} className={ACTION}>
            <Icon name="hand" size={12} />
            {t('chat.browser.returnControl')}
          </button>
        )}
      </div>
      {error !== null && (
        <div role="alert" className="px-[10px] py-[4px] text-[10.5px] text-mg-danger">
          {error}
        </div>
      )}
    </div>
  );
}
