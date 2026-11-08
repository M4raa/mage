import { useState } from 'react';
import type { MentionPreview } from '@shared/mentions';
import type { DeliverableCheck, TaskRecord } from '@shared/tasks';
import { useT } from '../../i18n/uiLanguage';
import { formatDateTime } from '../../i18n/format';
import { formatSize } from '../conversationList';
import { reportActionError } from '../notificationStore';
import { usePaneTabId } from '../paneContext';
import { useWorkbenchStore } from '../workbenchStore';
import { useTaskStore } from './taskStore';
import { planOf, taskOfTab, taskPhase, taskTitle } from './taskView';
import type { Block } from '../types';

const NO_BLOCKS: readonly Block[] = [];
const BUTTON_CLASS = 'rounded-[5px] border border-mg-border-ctrl px-[7px] py-[2px] text-[10.5px] text-mg-body2 hover:bg-mg-hover';

// Franja de la tarea bajo la sublínea de su pestaña (U30): objetivo, plan, progreso, permisos y entregables.
export function TaskStrip(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((candidate) => candidate.id === tabId));
  const liveSessionId = useWorkbenchStore((s) => s.sessionIdByChat[tabId]);
  const tasks = useTaskStore((s) => s.tasks);
  const task = tab === undefined ? undefined : taskOfTab(tasks, tab, liveSessionId);
  if (task === undefined) return null;
  return <StripBody task={task} tabId={tabId} />;
}

function StripBody({ task, tabId }: { readonly task: TaskRecord; readonly tabId: string }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(true);
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? NO_BLOCKS);
  const status = useWorkbenchStore((s) => s.statusByChat[tabId]);
  const pendingCount = useWorkbenchStore((s) => s.pendingByChat[tabId]?.length ?? 0);
  const plan = planOf(blocks);
  const done = plan?.filter((step) => step.done).length ?? 0;
  const phase = taskPhase({ status, pendingCount, task });
  const extraFolders = task.provider === 'codex' && task.folders.length > 1;
  const reverify = (): void => {
    void useTaskStore.getState().verify(task.id, task.deliverables.map((d) => d.declared)).catch((err: unknown) => reportActionError(t('tasks.error.verifyFailed'), err, 'tasks'));
  };
  return (
    <div data-task-strip="true" className="flex flex-col gap-[6px] border-b border-mg-border p-[6px_14px] text-[11px] text-mg-body">
      <div className="flex min-w-0 items-center gap-[8px]">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? t('tasks.strip.collapse') : t('tasks.strip.expand')} className="text-mg-icon hover:text-mg-body">{open ? '▾' : '▸'}</button>
        <span className="min-w-0 flex-1 truncate font-semibold" title={taskTitle(task.goal)}>{taskTitle(task.goal)}</span>
        <span data-task-phase={phase} title={phase === 'verified' ? t('tasks.deliverable.okHint') : undefined} className="text-[10.5px] text-mg-muted">{t(`tasks.phase.${phase}`)}</span>
        {plan !== null && <span className="text-[10.5px] text-mg-muted">{done}/{plan.length}</span>}
      </div>
      {open && (
        <>
          <Section label={t('tasks.strip.goal')}><div className="max-h-[7.5em] overflow-y-auto whitespace-pre-wrap">{task.goal}</div></Section>
          <Section label={t('tasks.strip.plan')}>
            {plan === null ? <span className="text-mg-muted">{t('tasks.strip.noPlan')}</span> : <PlanList plan={plan} done={done} />}
          </Section>
          {pendingCount > 0 && <div role="status" className="text-mg-warn-text">{t('tasks.strip.permissionsWaiting', { count: pendingCount })}</div>}
          <Section label={t('tasks.strip.deliverables')}>
            <Deliverables task={task} phase={phase} />
            {task.deliverables.length > 0 && <button data-task-reverify="true" onClick={reverify} className={`${BUTTON_CLASS} self-start`}>{t('tasks.strip.reverify')}</button>}
          </Section>
          {extraFolders && <div className="text-[10.5px] text-mg-muted">{t('tasks.strip.codexReadOnlyExtras')}</div>}
        </>
      )}
    </div>
  );
}

function Section({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[10px] font-bold uppercase tracking-[.06em] text-mg-ter">{label}</span>
      {children}
    </div>
  );
}

function PlanList({ plan, done }: { readonly plan: readonly { readonly text: string; readonly done: boolean }[]; readonly done: number }): React.JSX.Element {
  const t = useT();
  return (
    <>
      <ul className="flex flex-col gap-[1px]">
        {plan.map((step, index) => <li key={`${index}-${step.text}`}>{step.done ? '✓' : '○'} {step.text}</li>)}
      </ul>
      <span className="text-[10.5px] text-mg-muted">{t('tasks.strip.steps', { done, total: plan.length })}</span>
    </>
  );
}

function Deliverables({ task, phase }: { readonly task: TaskRecord; readonly phase: string }): React.JSX.Element {
  const t = useT();
  if (task.deliverables.length === 0) {
    return phase === 'working' || phase === 'waiting' ? <></> : <span className="text-mg-muted">{t('tasks.strip.noDeliverables')}</span>;
  }
  return <>{task.deliverables.map((deliverable) => <DeliverableRow key={deliverable.path} task={task} deliverable={deliverable} />)}</>;
}

// Nombre y carpeta de una ruta absoluta (el separador sale de la propia ruta: puede venir de cualquier SO).
function splitPath(fullPath: string): { readonly dir: string; readonly name: string } {
  const cut = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  return cut < 0 ? { dir: '', name: fullPath } : { dir: fullPath.slice(0, cut), name: fullPath.slice(cut + 1) };
}

function DeliverableRow({ task, deliverable }: { readonly task: TaskRecord; readonly deliverable: DeliverableCheck }): React.JSX.Element {
  const t = useT();
  const [preview, setPreview] = useState<MentionPreview | null>(null);
  const { dir, name } = splitPath(deliverable.path);
  const ok = deliverable.status === 'ok';
  const fail = (title: string) => (err: unknown): void => reportActionError(title, err, 'tasks');
  const showPreview = (): void => {
    const cwd = task.folders[0] ?? dir;
    void window.mage.previewMention({ cwd, accountDir: task.accountDir, absPath: deliverable.path }).then(setPreview).catch(fail(t('tasks.deliverable.preview')));
  };
  return (
    <div data-task-deliverable={deliverable.path} data-deliverable-status={deliverable.status} className="flex flex-col gap-[3px] rounded-[6px] border border-mg-border p-[5px_8px]">
      <div className="flex min-w-0 items-baseline gap-[8px]">
        <span className="font-semibold">{name}</span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-mg-muted" title={dir}>{dir}</span>
        <span title={ok ? t('tasks.deliverable.okHint') : undefined} className={ok ? 'text-mg-body' : 'text-mg-danger'}>{t(`tasks.deliverable.${deliverable.status}`)}</span>
      </div>
      {ok && deliverable.bytes !== null && deliverable.modifiedAtMs !== null && (
        <span className="text-[10.5px] text-mg-muted">{formatSize(deliverable.bytes)} · {formatDateTime(deliverable.modifiedAtMs)}</span>
      )}
      {ok && (
        <div className="flex gap-[6px]">
          <button onClick={() => void window.mage.openPath(deliverable.path).catch(fail(t('tasks.deliverable.open')))} className={BUTTON_CLASS}>{t('tasks.deliverable.open')}</button>
          <button onClick={() => void window.mage.saveTaskDeliverableCopy({ taskId: task.id, path: deliverable.path }).catch(fail(t('tasks.deliverable.saveCopy')))} className={BUTTON_CLASS}>{t('tasks.deliverable.saveCopy')}</button>
          <button onClick={showPreview} className={BUTTON_CLASS}>{t('tasks.deliverable.preview')}</button>
        </div>
      )}
      {preview !== null && <PreviewView preview={preview} />}
    </div>
  );
}

function PreviewView({ preview }: { readonly preview: MentionPreview }): React.JSX.Element {
  const t = useT();
  if (preview.kind === 'image') return <img src={preview.dataUrl} alt="" className="max-h-[180px] self-start rounded-[4px]" />;
  if (preview.kind === 'text') return <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-[4px] bg-mg-window p-[6px] text-[10.5px]">{preview.head}</pre>;
  return <span className="text-[10.5px] text-mg-muted">{t('tasks.deliverable.noPreview')}</span>;
}
