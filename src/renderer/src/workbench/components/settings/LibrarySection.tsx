import { useEffect, useMemo, useState } from 'react';
import type { LibraryAccountView, LibraryActionResult, LibraryEngine, LibraryEntryView, LibraryInstallView, LibraryView } from '@shared/ipc';
import type { Translate } from '@shared/i18n/translator';
import { useT } from '../../../i18n/uiLanguage';
import { describeError } from '../../describeError';
import { LibraryPreviewDialog } from './LibraryPreviewDialog';
import {
  blockKey,
  cardActions,
  filterEntries,
  indexInstalls,
  installKey,
  kindFilters,
  kindKey,
  platformKey,
  resultKey,
  selectedAccount,
  shortCommit,
  type CardAction,
  type LibraryFilter,
} from './libraryModel';
import { MCP_BUTTON_CLASS } from './mcpStyles';

// Sección «Biblioteca» (F6): skills, MCP y plugins para las cuentas de Claude y Codex. La instalación solo se
// ofrece dentro de la vista previa (P-U8). Lo instalado se aplica en la SIGUIENTE sesión de la cuenta (D-P7).

const LIST_SEPARATOR = ', ';
const REPO_MARK = '';
const ENGINE_NAMES: Readonly<Record<LibraryEngine, string>> = { claude: 'Claude', codex: 'Codex' };
const ACTION_KEYS = {
  preview: 'library.action.preview',
  enable: 'library.action.enable',
  disable: 'library.action.disable',
  update: 'library.action.update',
  remove: 'library.action.remove',
} as const satisfies Record<CardAction, string>;

type Notice = { readonly kind: 'result'; readonly result: LibraryActionResult } | { readonly kind: 'error'; readonly text: string };

export function LibrarySection(): React.JSX.Element {
  const t = useT();
  const [view, setView] = useState<LibraryView | null>(null);
  const [accountDir, setAccountDir] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [previewOf, setPreviewOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const account = view === null ? null : selectedAccount(view, accountDir);
  const installs = useMemo(() => indexInstalls(view?.installs ?? []), [view]);
  useEffect(() => {
    window.mage
      .libraryView()
      .then(setView)
      .catch((err: unknown) => setNotice({ kind: 'error', text: describeError(err) }));
  }, []);
  const apply = (action: CardAction | 'install', packageId: string): void => {
    if (account === null || action === 'preview') return;
    setBusy(true);
    window.mage
      .libraryApply({ action, packageId, engine: account.engine, accountDir: account.accountDir })
      .then((result) => setNotice({ kind: 'result', result }))
      .then(() => window.mage.libraryView())
      .then(setView)
      .catch((err: unknown) => setNotice({ kind: 'error', text: describeError(err) }))
      .finally(() => {
        setBusy(false);
        setPreviewOf(null);
      });
  };
  const previewEntry = view?.entries.find((entry) => entry.id === previewOf) ?? null;
  return (
    <div className="flex flex-col gap-[10px]" data-library-section="true">
      <p className="text-[11px] text-mg-sec">{t('settings.library.intro')}</p>
      {notice !== null && <NoticeBand notice={notice} />}
      {view === null && notice === null && <p className="text-[11px] text-mg-muted">{t('mcp.common.loading')}</p>}
      {view !== null && account === null && <p className="text-[11px] text-mg-muted">{t('library.account.none')}</p>}
      {view !== null && account !== null && (
        <>
          <AccountPicker accounts={view.accounts} value={account.accountDir} onChange={setAccountDir} />
          <FilterBar entries={view.entries} filter={filter} onChange={setFilter} />
          {filterEntries(view.entries, filter).map((entry) => (
            <LibraryCard
              key={entry.id}
              entry={entry}
              install={installs.get(installKey(entry.id, account.engine, account.accountDir)) ?? null}
              busy={busy}
              onAction={(action) => (action === 'preview' ? setPreviewOf(entry.id) : apply(action, entry.id))}
            />
          ))}
        </>
      )}
      {previewEntry !== null && account !== null && (
        <LibraryPreviewDialog entry={previewEntry} account={account} busy={busy} onInstall={() => apply('install', previewEntry.id)} onClose={() => setPreviewOf(null)} />
      )}
    </div>
  );
}

function NoticeBand({ notice }: { readonly notice: Notice }): React.JSX.Element {
  const t = useT();
  if (notice.kind === 'error') {
    return (
      <div role="status" data-library-notice="error" className="rounded-[7px] border border-mg-border-subtle p-[7px_10px] text-[10.5px] text-mg-danger">
        {notice.text}
      </div>
    );
  }
  const { result } = notice;
  const items = 'items' in result ? result.items.join(LIST_SEPARATOR) : '';
  const detail = 'detail' in result ? result.detail : '';
  return (
    <div role="status" data-library-notice={result.status} className="rounded-[7px] border border-mg-border-subtle p-[7px_10px] text-[10.5px] text-mg-body2">
      {t(resultKey(result), { items, detail })}
    </div>
  );
}

function AccountPicker({ accounts, value, onChange }: { readonly accounts: readonly LibraryAccountView[]; readonly value: string; readonly onChange: (dir: string) => void }): React.JSX.Element {
  const t = useT();
  return (
    <label className="flex items-center gap-[8px] text-[10.5px] text-mg-sec">
      {t('library.account.label')}
      <select
        data-library-account
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] text-[11px] text-mg-body"
      >
        {accounts.map((account) => (
          <option key={account.accountDir} value={account.accountDir}>
            {t('library.account.option', { engine: ENGINE_NAMES[account.engine], label: account.label })}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterBar({ entries, filter, onChange }: { readonly entries: readonly LibraryEntryView[]; readonly filter: LibraryFilter; readonly onChange: (filter: LibraryFilter) => void }): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-[4px]">
      {kindFilters(entries).map((item) => (
        <button key={item} aria-pressed={item === filter} data-library-filter={item} onClick={() => onChange(item)} className={`${MCP_BUTTON_CLASS} aria-pressed:bg-mg-hover`}>
          {item === 'all' ? t('library.filter.all') : t(kindKey(item))}
        </button>
      ))}
    </div>
  );
}

interface CardProps {
  readonly entry: LibraryEntryView;
  readonly install: LibraryInstallView | null;
  readonly busy: boolean;
  readonly onAction: (action: CardAction) => void;
}

function LibraryCard({ entry, install, busy, onAction }: CardProps): React.JSX.Element {
  const t = useT();
  const status = installStatus(install);
  return (
    <article data-library-entry={entry.id} data-library-status={status} className="flex flex-col gap-[4px] rounded-[8px] border border-mg-border-subtle p-[9px_11px] text-[10.5px] text-mg-sec">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="text-[11.5px] font-bold text-mg-body">{entry.title}</span>
        <span data-library-kind className="rounded-[4px] border border-mg-border-subtle px-[5px] text-[9.5px]">
          {t(kindKey(entry.kind))}
        </span>
        <span>{t('library.version', { version: entry.version })}</span>
        <span>{t('library.publisher', { publisher: entry.publisher })}</span>
      </div>
      <p lang="en" className="text-[10.5px] text-mg-body2">
        {entry.summary}
      </p>
      <CardSource entry={entry} />
      <CardCompatibility entry={entry} />
      <CardStatus entry={entry} install={install} />
      <div className="flex flex-wrap justify-end gap-[4px]">
        {cardActions(install).map((action) => (
          <button key={action} data-library-action={action} disabled={busy} onClick={() => onAction(action)} className={MCP_BUTTON_CLASS}>
            {t(ACTION_KEYS[action])}
          </button>
        ))}
      </div>
    </article>
  );
}

function installStatus(install: LibraryInstallView | null): 'installed' | 'disabled' | 'none' {
  if (install === null) return 'none';
  return install.enabled ? 'installed' : 'disabled';
}

function ExternalLink({ url, children }: { readonly url: string; readonly children: React.ReactNode }): React.JSX.Element {
  const open = (e: React.MouseEvent): void => {
    e.preventDefault();
    void window.mage.openExternal(url);
  };
  return (
    <a href={url} onClick={open} className="text-mg-focus underline">
      {children}
    </a>
  );
}

function CardSource({ entry }: { readonly entry: LibraryEntryView }): React.JSX.Element {
  const t = useT();
  const { provenance, license } = entry;
  const commit = shortCommit(provenance.commit);
  // El repositorio es un enlace dentro de la frase traducida: se parte por un marcador que el texto no contiene.
  const [before, after] = t('library.provenance', { repo: REPO_MARK, ref: provenance.ref, date: provenance.retrievedAt }).split(REPO_MARK);
  return (
    <div className="flex flex-wrap gap-x-[8px]">
      <span>
        {before}
        <ExternalLink url={provenance.repo}>{provenance.repo}</ExternalLink>
        {after}
      </span>
      {commit !== null && <span>{t('library.provenanceCommit', { commit })}</span>}
      <ExternalLink url={license.url}>{t('library.license', { spdx: license.spdx })}</ExternalLink>
      <span>{entry.distribution === 'copied' ? t('library.distribution.copied') : t('library.distribution.linked')}</span>
    </div>
  );
}

function CardCompatibility({ entry }: { readonly entry: LibraryEntryView }): React.JSX.Element {
  const t = useT();
  const platforms = entry.platforms.map((platform) => platformLabel(t, platform));
  return (
    <>
      <div>{t('library.platforms', { list: platforms.join(LIST_SEPARATOR) })}</div>
      <div>
        {t('library.scope.account')}
        {entry.scopes.includes('project') && ` · ${t('library.scope.projectLater')}`}
      </div>
      {entry.engines.map((engine) => (
        <EngineLine key={engine} entry={entry} engine={engine} t={t} />
      ))}
      {entry.runsCode && (
        <div data-library-runs-code className="text-mg-warn-text">
          {t('library.runsCode')}
        </div>
      )}
      {entry.requiresSecrets.length > 0 && <div className="text-mg-warn-text">{t('library.needsSecrets', { names: entry.requiresSecrets.join(LIST_SEPARATOR) })}</div>}
      {entry.missingCommands.map((command) => (
        <div key={command} className="text-mg-warn-text">
          {t('library.missingCommand', { command })}
        </div>
      ))}
    </>
  );
}

function platformLabel(t: Translate, platform: string): string {
  const key = platformKey(platform);
  return key === null ? platform : t(key);
}

function EngineLine({ entry, engine, t }: { readonly entry: LibraryEntryView; readonly engine: LibraryEngine; readonly t: Translate }): React.JSX.Element {
  const block = entry.blocks[engine];
  const name = ENGINE_NAMES[engine];
  return (
    <div data-library-engine={engine} data-library-block={block ?? ''}>
      {block === null ? t('library.engineOk', { engine: name }) : `${t('library.engineBlocked', { engine: name })} — ${t(blockKey(block))}`}
    </div>
  );
}

function CardStatus({ entry, install }: { readonly entry: LibraryEntryView; readonly install: LibraryInstallView | null }): React.JSX.Element | null {
  const t = useT();
  if (install === null) return null;
  const version = install.version;
  return (
    <div>
      {install.enabled ? t('library.status.installed', { version }) : t('library.status.disabled', { version })}
      {install.updateAvailable && ` · ${t('library.status.updateAvailable', { version: entry.version })}`}
    </div>
  );
}
