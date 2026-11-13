import { useEffect, useMemo, useState } from 'react';
import type { DesktopScheduledTaskFile } from '@shared/tasks';
import { formatDateTime } from '@shared/i18n/format';
import { activeFormatLocale } from '../../i18n/format';
import { useT } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';
import { useWorkbenchStore } from '../workbenchStore';
import { desktopRunsOf, desktopTaskOf, filterDesktopTasks, type DesktopTaskView } from './scheduledTasksModel';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly files: readonly DesktopScheduledTaskFile[] }
  | { readonly kind: 'error'; readonly message: string };

// Lee los SKILL.md de Claude Desktop al abrir la pestaña; `alive` evita pintar tras desmontarla.
function useDesktopFiles(): Load {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    window.mage.listDesktopScheduledTasks()
      .then((files) => { if (alive) setLoad({ kind: 'ready', files }); })
      .catch((err: unknown) => { if (alive) setLoad({ kind: 'error', message: describeError(err) }); });
    return () => { alive = false; };
  }, []);
  return load;
}

// Pestaña «De Claude Desktop»: solo lectura. El horario lo guarda Claude Desktop y Mage no puede leerlo.
export function DesktopTasksTab({ query }: { readonly query: string }): React.JSX.Element {
  const t = useT();
  const load = useDesktopFiles();
  const views = useMemo(() => (load.kind === 'ready' ? load.files.map(desktopTaskOf) : []), [load]);
  const shown = filterDesktopTasks(views, query);
  if (load.kind === 'error') return <div role="alert" className="text-[11.5px] text-mg-danger">{t('scheduledTasks.desktopLoadError', { error: load.message })}</div>;
  return (
    <div className="flex flex-col gap-[8px]">
      {load.kind === 'ready' && shown.length === 0 && (
        <p data-scheduled-empty="true" className="p-[10px_2px] text-[11.5px] text-mg-muted">{views.length === 0 ? t('scheduledTasks.desktopEmpty') : t('scheduledTasks.noMatches')}</p>
      )}
      {shown.map((view) => <DesktopCard key={view.key} view={view} />)}
    </div>
  );
}

function DesktopCard({ view }: { readonly view: DesktopTaskView }): React.JSX.Element {
  const t = useT();
  const alias = useWorkbenchStore((s) => s.accounts.find((a) => a.id === view.accountDir)?.alias);
  const history = useWorkbenchStore((s) => s.allConversationHistory);
  const runs = useMemo(() => desktopRunsOf(history, view.name), [history, view.name]);
  return (
    <div data-desktop-task={view.name} className="flex flex-col gap-[6px] rounded-[9px] border border-mg-border-subtle bg-mg-window p-[10px_12px]">
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-mg-text" title={view.name}>{view.name}</span>
        {alias !== undefined && <span className="text-[10.5px] text-mg-muted">{alias}</span>}
        <span data-desktop-managed="true" className="rounded-[5px] border border-mg-border-ctrl px-[6px] py-[1px] text-[10px] text-mg-muted">{t('scheduledTasks.desktopManaged')}</span>
      </div>
      {view.description.length > 0 && <span className="text-mg-body2">{view.description}</span>}
      <pre className="whitespace-pre-wrap break-words font-sans text-[11.5px] text-mg-body">{view.promptPreview}</pre>
      <span className="text-[11px] text-mg-muted">{t('scheduledTasks.desktopNoSchedule')}</span>
      <DesktopRuns runs={runs} />
    </div>
  );
}

function DesktopRuns({ runs }: { readonly runs: ReturnType<typeof desktopRunsOf> }): React.JSX.Element {
  const t = useT();
  const openConversation = useWorkbenchStore((s) => s.openConversation);
  const closeScreen = useWorkbenchStore((s) => s.closeScheduledTasks);
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('scheduledTasks.desktopRuns').toUpperCase()}</span>
      {runs.length === 0 && <span className="text-[11px] text-mg-muted">{t('scheduledTasks.desktopNoRuns')}</span>}
      {runs.map(({ item, accountId }) => (
        <button
          key={item.sessionId} data-desktop-run={item.sessionId}
          onClick={() => { closeScreen(); openConversation(item, accountId); }}
          className="flex items-center gap-[8px] rounded-[6px] p-[3px_6px] text-left text-[11.5px] text-mg-body hover:bg-mg-hover"
        >
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <span className="text-[10.5px] text-mg-muted">{formatDateTime(item.updatedAtMs, activeFormatLocale())}</span>
        </button>
      ))}
    </div>
  );
}
