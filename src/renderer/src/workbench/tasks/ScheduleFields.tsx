import { activeFormatLocale } from '../../i18n/format';
import { useT } from '../../i18n/uiLanguage';
import type { ScheduleForm } from './taskScheduleForm';
import { weekdayName } from './scheduledTasksModel';

const FIELD_CLASS = 'w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none';
const KINDS: readonly ScheduleForm['kind'][] = ['once', 'hourly', 'daily', 'weekdays', 'weekly'];
// Lunes primero (como en Europa); el domingo, que es 0 para `getUTCDay`, va el último.
const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
const MAX_MINUTE = 59;

interface ScheduleFieldsProps {
  readonly form: ScheduleForm;
  readonly onChange: (form: ScheduleForm) => void;
}

function LabeledField({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[4px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

// Controles de la programación; los que enseña dependen de la frecuencia elegida.
export function ScheduleFields({ form, onChange }: ScheduleFieldsProps): React.JSX.Element {
  const t = useT();
  const set = (patch: Partial<ScheduleForm>): void => onChange({ ...form, ...patch });
  const showDate = form.kind === 'once';
  const showWeekday = form.kind === 'weekly';
  const showMinute = form.kind === 'hourly';
  const showTime = !showMinute;
  return (
    <div className="flex flex-col gap-[10px]">
      <LabeledField label={t('tasks.dialog.scheduleKind')}>
        <select data-task-schedule-kind="true" value={form.kind} onChange={(e) => set({ kind: e.target.value as ScheduleForm['kind'] })} className={FIELD_CLASS}>
          {KINDS.map((kind) => <option key={kind} value={kind}>{t(`tasks.dialog.kind.${kind}`)}</option>)}
        </select>
      </LabeledField>
      {showDate && (
        <LabeledField label={t('tasks.dialog.date')}>
          <input type="date" data-task-date="true" value={form.date} onChange={(e) => set({ date: e.target.value })} className={FIELD_CLASS} />
        </LabeledField>
      )}
      {showWeekday && (
        <LabeledField label={t('tasks.dialog.weekday')}>
          <select data-task-weekday="true" value={form.weekday} onChange={(e) => set({ weekday: e.target.value })} className={FIELD_CLASS}>
            {WEEKDAY_ORDER.map((day) => <option key={day} value={String(day)}>{weekdayName(day, activeFormatLocale())}</option>)}
          </select>
        </LabeledField>
      )}
      {showTime && (
        <LabeledField label={t('tasks.dialog.time')}>
          <input type="time" data-task-time="true" value={form.time} onChange={(e) => set({ time: e.target.value })} className={FIELD_CLASS} />
        </LabeledField>
      )}
      {showMinute && (
        <LabeledField label={t('tasks.dialog.minute')}>
          <input type="number" min={0} max={MAX_MINUTE} data-task-minute="true" value={form.minute} onChange={(e) => set({ minute: e.target.value })} className={FIELD_CLASS} />
        </LabeledField>
      )}
    </div>
  );
}
