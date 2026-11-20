import { useEffect, useState } from 'react';
import { ARTIFACT_VIEWER_SESSION_ID, type AccountArtifacts, type ArtifactRel, type ArtifactSummary } from '@shared/artifactLibrary';
import { useT } from '../../i18n/uiLanguage';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { describeError } from '../describeError';
import { withMorePage } from '../artifactsLibraryModel';
import { artifactsSource } from '../artifactsSource';
import { BrowserPanelBody } from '../browser/BrowserPanel';
import { useBrowserStore } from '../browser/browserStore';
import { useWorkbenchStore } from '../workbenchStore';
import { ArtifactsLibraryList, itemKey, listKey } from './ArtifactsLibraryList';
import { Icon } from './Icon';

// Pantalla «Artifacts»: todos los artifacts de todas las cuentas de Claude por suscripción (los creados y los
// compartidos con cada una), a la izquierda, y el visor a la derecha. El visor es el navegador de Mage (la misma barra
// y la misma vista aislada, sin cookies de claude.ai) con el id reservado del visor: no necesita ninguna conversación.
// Se abre desde el panel «Artifacts» («Todos los artifacts»).

export function ArtifactsLibraryView(): React.JSX.Element | null {
  const open = useWorkbenchStore((s) => s.artifactsLibraryOpen);
  return open ? <ArtifactsLibraryDialog /> : null;
}

type Load = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly entries: readonly AccountArtifacts[] } | { readonly kind: 'error'; readonly message: string };

function warnClose(err: unknown): void {
  console.warn('No se pudo cerrar el visor de artifacts', describeError(err));
}

function useArtifactLists() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [round, setRound] = useState({ n: 0, refresh: false });
  const [loadingMore, setLoadingMore] = useState<ReadonlySet<string>>(new Set());
  const [moreErrors, setMoreErrors] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    let alive = true;
    setLoad((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    artifactsSource
      .list({ refresh: round.refresh })
      .then((entries) => alive && setLoad({ kind: 'ready', entries }))
      .catch((err: unknown) => alive && setLoad({ kind: 'error', message: describeError(err) }));
    return () => {
      alive = false;
    };
  }, [round]);
  const more = (accountId: string, rel: ArtifactRel, pageToken: string): void => {
    const key = listKey(accountId, rel);
    setLoadingMore((s) => new Set(s).add(key));
    setMoreErrors(({ [key]: _gone, ...rest }) => rest);
    artifactsSource
      .more({ accountId, rel, pageToken })
      .then((page) => setLoad((current) => (current.kind === 'ready' ? { kind: 'ready', entries: withMorePage(current.entries, page) } : current)))
      .catch((err: unknown) => setMoreErrors((errors) => ({ ...errors, [key]: describeError(err) })))
      .finally(() => setLoadingMore((s) => new Set([...s].filter((k) => k !== key))));
  };
  return { load, loadingMore, moreErrors, more, refresh: () => setRound((r) => ({ n: r.n + 1, refresh: true })) };
}

type Opening = { readonly key: string; readonly title: string; readonly error: string | null; readonly busy: boolean };

function useViewer() {
  const [opening, setOpening] = useState<Opening | null>(null);
  const open = (item: ArtifactSummary): void => {
    const key = itemKey(item);
    setOpening({ key, title: item.title, error: null, busy: true });
    artifactsSource
      .open({ accountId: item.accountId, id: item.id })
      .then(() => setOpening((o) => (o?.key === key ? { ...o, busy: false } : o)))
      .catch((err: unknown) => setOpening((o) => (o?.key === key ? { ...o, busy: false, error: describeError(err) } : o)));
  };
  return { opening, open, setOpening };
}

function ArtifactsLibraryDialog(): React.JSX.Element {
  const t = useT();
  const closeLibrary = useWorkbenchStore((s) => s.closeArtifactsLibrary);
  const dialogRef = useDialogA11y({ onClose: closeLibrary });
  const lists = useArtifactLists();
  const viewer = useViewer();
  // Cerrar la pantalla libera la vista del visor (y su partición).
  useEffect(() => () => void window.mage.browserClose(ARTIFACT_VIEWER_SESSION_ID).catch(warnClose), []);
  const openOutside = (url: string): void => {
    window.mage.openExternal(url).catch((err: unknown) => viewer.setOpening((o) => ({ key: o?.key ?? '', title: o?.title ?? '', busy: false, error: describeError(err) })));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={closeLibrary}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="artifacts-library-title" data-artifacts-library="true" onClick={(e) => e.stopPropagation()} className="flex h-[min(90vh,900px)] w-[min(96vw,1400px)] flex-col overflow-hidden rounded-[11px] border border-mg-border-pop bg-mg-panel text-[12px] mg-shadow-modal">
        <LibraryHeader onRefresh={lists.refresh} onClose={closeLibrary} />
        <div className="flex min-h-0 flex-1">
          <nav aria-label={t('artifactsLibrary.listAria')} className="flex w-[320px] flex-none flex-col overflow-y-auto border-r border-mg-border-subtle">
            {lists.load.kind === 'loading' && <p className="p-[12px] text-[11px] text-mg-muted">{t('artifactsLibrary.loading')}</p>}
            {lists.load.kind === 'error' && <p role="alert" className="p-[12px] text-[11px] text-mg-danger">{t('artifactsLibrary.loadError', { error: lists.load.message })}</p>}
            {lists.load.kind === 'ready' && (
              <ArtifactsLibraryList entries={lists.load.entries} selectedKey={viewer.opening?.key ?? null} loadingMore={lists.loadingMore} moreErrors={lists.moreErrors} onOpen={viewer.open} onOpenOutside={openOutside} onMore={lists.more} />
            )}
          </nav>
          <ViewerPane opening={viewer.opening} />
        </div>
      </div>
    </div>
  );
}

function LibraryHeader({ onRefresh, onClose }: { readonly onRefresh: () => void; readonly onClose: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <header className="flex items-center gap-[10px] border-b border-mg-border-subtle p-[12px_18px]">
      <h2 id="artifacts-library-title" className="flex-1 text-[14px] font-semibold text-mg-text">{t('artifactsLibrary.title')}</h2>
      <button data-artifacts-refresh onClick={onRefresh} className="flex items-center gap-[5px] rounded-[6px] border border-mg-border-emph px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">
        <Icon name="refresh" size={12} />
        {t('artifactsLibrary.refresh')}
      </button>
      <button onClick={onClose} aria-label={t('artifactsLibrary.close')} className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body">
        <Icon name="close" size={13} />
      </button>
    </header>
  );
}

function ViewerPane({ opening }: { readonly opening: Opening | null }): React.JSX.Element {
  const t = useT();
  const state = useBrowserStore((s) => s.states[ARTIFACT_VIEWER_SESSION_ID] ?? null);
  const title = opening === null || opening.title.length === 0 ? t('artifactsLibrary.untitled') : opening.title;
  return (
    <main data-artifacts-viewer={state === null ? 'empty' : 'open'} className="flex min-w-0 flex-1 flex-col">
      {opening?.busy === true && <p role="status" className="px-[12px] py-[6px] text-[11px] text-mg-muted">{t('artifactsLibrary.opening', { title })}</p>}
      {opening?.error != null && <p role="alert" className="px-[12px] py-[6px] text-[11px] text-mg-danger">{t('artifactsLibrary.openError', { title, error: opening.error })}</p>}
      {state === null ? (
        <p className="m-auto max-w-[420px] p-[14px] text-center text-[11px] text-mg-muted">{t('artifactsLibrary.viewerHint')}</p>
      ) : (
        <BrowserPanelBody sessionId={ARTIFACT_VIEWER_SESSION_ID} state={state} place="viewer" />
      )}
    </main>
  );
}
