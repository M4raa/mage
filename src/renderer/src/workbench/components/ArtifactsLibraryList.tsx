import type { AccountArtifacts, ArtifactPageResult, ArtifactRel, ArtifactSummary } from '@shared/artifactLibrary';
import { renderLocalized } from '@shared/i18n/localizedText';
import { useT } from '../../i18n/uiLanguage';
import { formatDayMonth } from '../../i18n/format';
import { audienceLabel } from '../artifactsLibraryModel';
import { useWorkbenchStore } from '../workbenchStore';
import { Icon } from './Icon';

// Columna izquierda de la pantalla «Artifacts»: por cuenta, sus creados y lo compartido con ella, cada lista con su
// error y su «Cargar más». La lógica (fusionar páginas, etiquetas) vive en `artifactsLibraryModel.ts`.

export interface LibraryListProps {
  readonly entries: readonly AccountArtifacts[];
  readonly selectedKey: string | null;
  readonly loadingMore: ReadonlySet<string>;
  readonly moreErrors: Readonly<Record<string, string>>;
  readonly onOpen: (item: ArtifactSummary) => void;
  readonly onOpenOutside: (url: string) => void;
  readonly onMore: (accountId: string, rel: ArtifactRel, pageToken: string) => void;
}

// Clave de una fila (la misma id puede estar en dos cuentas) y de una lista.
export const itemKey = (item: Pick<ArtifactSummary, 'accountId' | 'id'>): string => `${item.accountId}\n${item.id}`;
export const listKey = (accountId: string, rel: ArtifactRel): string => `${accountId}\n${rel}`;

export function ArtifactsLibraryList(props: LibraryListProps): React.JSX.Element {
  const t = useT();
  if (props.entries.length === 0) return <p className="p-[12px] text-[11px] text-mg-muted">{t('artifactsLibrary.noAccounts')}</p>;
  return (
    <div className="flex flex-col gap-[14px] p-[10px]">
      {props.entries.map((entry) => <AccountSection key={entry.accountId} entry={entry} {...props} />)}
    </div>
  );
}

function useAccountLabel(accountId: string): string {
  const account = useWorkbenchStore((s) => s.accounts.find((candidate) => candidate.id === accountId));
  if (account !== undefined) return `${account.provider} · ${account.alias}`;
  const parts = accountId.split(/[\\/]/);
  return parts[parts.length - 1] ?? accountId;
}

function AccountSection({ entry, ...props }: LibraryListProps & { readonly entry: AccountArtifacts }): React.JSX.Element {
  const label = useAccountLabel(entry.accountId);
  return (
    <section data-artifacts-account={entry.accountId} aria-label={label} className="flex flex-col gap-[6px]">
      <h3 data-artifacts-account-label className="truncate px-[4px] text-[11.5px] font-semibold text-mg-text">{label}</h3>
      <ListBlock accountId={entry.accountId} rel="mine" result={entry.mine} {...props} />
      <ListBlock accountId={entry.accountId} rel="shared" result={entry.shared} {...props} />
    </section>
  );
}

interface ListBlockProps extends LibraryListProps {
  readonly accountId: string;
  readonly rel: ArtifactRel;
  readonly result: ArtifactPageResult;
}

function ListBlock({ accountId, rel, result, ...props }: ListBlockProps): React.JSX.Element {
  const t = useT();
  const key = listKey(accountId, rel);
  const count = result.ok ? result.page.items.length : 0;
  return (
    <div data-artifacts-list={rel} className="flex flex-col gap-[2px]">
      <span className="px-[4px] text-[10px] font-bold tracking-[.06em] text-mg-ter">
        {t(rel === 'mine' ? 'artifactsLibrary.mine' : 'artifactsLibrary.shared', { count })}
      </span>
      {!result.ok && <p role="alert" className="px-[4px] text-[10.5px] text-mg-danger">{t('artifactsLibrary.listError', { error: renderLocalized(t, result.error) })}</p>}
      {result.ok && count === 0 && <p className="px-[4px] text-[10.5px] text-mg-muted">{t('artifactsLibrary.emptyList')}</p>}
      {result.ok && result.page.items.map((item) => (
        <ArtifactRow key={item.id} item={item} selected={props.selectedKey === itemKey(item)} onOpen={props.onOpen} onOpenOutside={props.onOpenOutside} />
      ))}
      {result.ok && result.page.nextPageToken !== null && (
        <MoreButton busy={props.loadingMore.has(key)} onClick={() => props.onMore(accountId, rel, result.page.nextPageToken ?? '')} />
      )}
      {props.moreErrors[key] !== undefined && <p role="alert" className="px-[4px] text-[10.5px] text-mg-danger">{props.moreErrors[key]}</p>}
    </div>
  );
}

function MoreButton({ busy, onClick }: { readonly busy: boolean; readonly onClick: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <button data-artifacts-more disabled={busy} onClick={onClick} className="mx-[4px] mt-[2px] self-start rounded-[6px] border border-mg-border-ctrl px-[8px] py-[2px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50">
      {busy ? t('artifactsLibrary.loadingMore') : t('artifactsLibrary.loadMore')}
    </button>
  );
}

function rowMeta(t: ReturnType<typeof useT>, item: ArtifactSummary): string {
  const parts = [audienceLabel(t, item.audience)];
  if (item.sortTime !== null) parts.push(formatDayMonth(item.sortTime));
  if (item.external) parts.push(t('artifactsLibrary.external'));
  return parts.filter((part) => part.length > 0).join(' · ');
}

interface RowProps extends Pick<LibraryListProps, 'onOpen' | 'onOpenOutside'> {
  readonly item: ArtifactSummary;
  readonly selected: boolean;
}

function ArtifactRow({ item, selected, onOpen, onOpenOutside }: RowProps): React.JSX.Element {
  const t = useT();
  const title = item.title.length > 0 ? item.title : t('artifactsLibrary.untitled');
  return (
    <div className={`flex items-center gap-[2px] rounded-[7px] ${selected ? 'bg-mg-sel' : 'hover:bg-mg-hover'}`}>
      <button data-artifact-row={item.id} data-artifact-rel={item.rel} aria-current={selected} onClick={() => onOpen(item)} className="flex min-w-0 flex-1 flex-col items-start p-[5px_8px] text-left">
        <span className="w-full truncate text-[11.5px] text-mg-text">{title}</span>
        <span data-artifact-audience={item.audience} className="w-full truncate text-[10px] text-mg-muted">{rowMeta(t, item)}</span>
      </button>
      {item.openUrl.length > 0 && (
        <button
          aria-label={t('artifactsLibrary.openOnClaudeAria', { title })}
          title={t('artifactsLibrary.openOnClaude')}
          onClick={() => onOpenOutside(item.openUrl)}
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[6px] text-mg-muted hover:text-mg-body"
        >
          <Icon name="external" size={12} />
        </button>
      )}
    </div>
  );
}
