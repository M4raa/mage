import { useCallback, useEffect, useState } from 'react';
import type { HostClientView } from '@shared/hostClients';
import { HOST_CLIENT_KIND_KEY } from '../HostPairDialog';
import { useT } from '../../../i18n/uiLanguage';
import { formatDateTime } from '../../../i18n/format';
import { describeError } from '../../describeError';

// Clientes emparejados del host local (la terminal) con «Revocar». Main es la fuente: la lista se relee al montar, tras
// revocar y cada vez que cambian las peticiones de emparejar (una autorizada añade un cliente).

export function HostClientsList(): React.JSX.Element {
  const t = useT();
  const { clients, error, revoke } = useHostClients();
  return (
    <section data-host-clients="true" className="flex flex-col gap-[6px] border-t border-mg-border pt-[14px]">
      <h3 className="text-[11px] font-semibold text-mg-body">{t('settings.hooks.hostClients.heading')}</h3>
      <p className="text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.hooks.hostClients.hint')}</p>
      {error !== null && <div role="alert" className="text-[11px] text-mg-danger">{t('settings.hooks.hostClients.failed', { error })}</div>}
      {clients.length === 0
        ? <p className="text-[11px] text-mg-muted">{t('settings.hooks.hostClients.empty')}</p>
        : <ul className="flex flex-col gap-[3px]">{clients.map((client) => <HostClientRow key={client.id} client={client} onRevoke={revoke} />)}</ul>}
    </section>
  );
}

function useHostClients(): { readonly clients: readonly HostClientView[]; readonly error: string | null; readonly revoke: (id: string) => void } {
  const [clients, setClients] = useState<readonly HostClientView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fail = (err: unknown): void => setError(err instanceof Error ? describeError(err) : String(err));
  const refresh = useCallback(() => {
    void window.mage.listHostClients().then((next) => { setClients(next); setError(null); }, fail);
  }, []);
  useEffect(() => {
    refresh();
    return window.mage.onHostPairRequests(() => refresh());
  }, [refresh]);
  const revoke = (id: string): void => {
    void window.mage.revokeHostClient(id).then(refresh, fail);
  };
  return { clients, error, revoke };
}

function HostClientRow({ client, onRevoke }: { readonly client: HostClientView; readonly onRevoke: (id: string) => void }): React.JSX.Element {
  const t = useT();
  const lastUsed = client.lastUsedAt === null ? t('settings.hooks.hostClients.never') : formatDateTime(Date.parse(client.lastUsedAt));
  return (
    <li data-host-client={client.id} className="flex items-center gap-[8px] rounded-[6px] p-[4px_7px] text-[11px] hover:bg-mg-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-mg-body">{client.name}</span>
        <span className="block truncate text-[10.5px] text-mg-ter">
          {t('settings.hooks.hostClients.meta', { kind: t(HOST_CLIENT_KIND_KEY[client.kind]), created: formatDateTime(Date.parse(client.createdAt)), lastUsed })}
        </span>
      </span>
      <button
        type="button"
        data-host-client-revoke={client.id}
        onClick={() => onRevoke(client.id)}
        className="flex-none rounded-[6px] border border-mg-border-emph px-[9px] py-[3px] text-mg-body transition-colors duration-90 ease-out hover:bg-mg-hover"
      >
        {t('settings.hooks.hostClients.revoke')}
      </button>
    </li>
  );
}
