import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@shared/conversations';
import type { Translate } from '@shared/i18n/translator';
import type { TaskRecord } from '@shared/tasks';
import {
  desktopRunsOf, desktopTaskOf, describeSchedule, duplicateDraftOf, filterDesktopTasks, filterTasks, lastRunKind, weekdayName,
} from './scheduledTasksModel';

const fake = ((key: string, params?: unknown) => `${key}|${JSON.stringify(params)}`) as unknown as Translate;
const MADRID = 'Europe/Madrid';

const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't1', name: 'Informe diario', schedule: null, enabled: true, nextRunAtMs: null, lastRun: null,
  goal: 'Resume las ventas', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/f'], documents: [], capabilities: [],
  createdAtMs: 0, sessionId: null, conversationId: null, deliverables: [], verifiedAtMs: null, verdict: 'pending', ...over,
});

describe('filterTasks', () => {
  const tasks = [task(), task({ id: 't2', name: 'Otra', goal: 'Limpia el DISCO' })];

  it('filterTasks_consultaVacia_todas', () => {
    expect(filterTasks(tasks, '  ')).toEqual(tasks);
  });
  it('filterTasks_sinCoincidencia_vacio', () => {
    expect(filterTasks(tasks, 'zzz')).toEqual([]);
  });
  it('filterTasks_porNombreYPorObjetivo_sinMayusculas', () => {
    expect(filterTasks(tasks, 'INFORME').map((x) => x.id)).toEqual(['t1']);
    expect(filterTasks(tasks, 'disco').map((x) => x.id)).toEqual(['t2']);
  });
});

describe('lastRunKind', () => {
  const run = { atMs: 1, scheduledForMs: 1, late: false, outcome: 'started' as const, error: null };

  it('lastRunKind_sinEjecucion_never', () => {
    expect(lastRunKind({ lastRun: null })).toBe('never');
  });
  it('lastRunKind_iniciada_started', () => {
    expect(lastRunKind({ lastRun: run })).toBe('started');
  });
  it('lastRunKind_conRetraso_late', () => {
    expect(lastRunKind({ lastRun: { ...run, late: true } })).toBe('late');
  });
  it('lastRunKind_fallida_failed', () => {
    expect(lastRunKind({ lastRun: { ...run, late: true, outcome: 'failed', error: 'x' } })).toBe('failed');
  });
});

describe('describeSchedule', () => {
  it('describeSchedule_unaVez_conFechaFormateada', () => {
    const text = describeSchedule({ kind: 'once', date: '2026-07-01', time: { hour: 12, minute: 0 }, timeZone: MADRID }, fake, 'es-ES');

    expect(text.startsWith('scheduledTasks.schedule.once|')).toBe(true);
    expect(text).toContain('"when"');
  });
  it('describeSchedule_cadaHora_minuto', () => {
    expect(describeSchedule({ kind: 'hourly', minute: 5, timeZone: MADRID }, fake, 'es')).toBe('scheduledTasks.schedule.hourly|{"minute":"5"}');
  });
  it('describeSchedule_diariaYLaborables_horaConCeros', () => {
    const time = { hour: 9, minute: 5 };

    expect(describeSchedule({ kind: 'daily', time, timeZone: MADRID }, fake, 'es')).toBe('scheduledTasks.schedule.daily|{"time":"09:05"}');
    expect(describeSchedule({ kind: 'weekdays', time, timeZone: MADRID }, fake, 'es')).toBe('scheduledTasks.schedule.weekdays|{"time":"09:05"}');
  });
  it('describeSchedule_semanal_nombreDelDia', () => {
    const text = describeSchedule({ kind: 'weekly', weekday: 3, time: { hour: 10, minute: 0 }, timeZone: MADRID }, fake, 'en-US');

    expect(text).toBe('scheduledTasks.schedule.weekly|{"weekday":"Wednesday","time":"10:00"}');
  });
});

describe('weekdayName', () => {
  it('weekdayName_domingoYSabado', () => {
    expect(weekdayName(0, 'en-US')).toBe('Sunday');
    expect(weekdayName(6, 'en-US')).toBe('Saturday');
  });
});

describe('duplicateDraftOf', () => {
  it('duplicateDraftOf_nombreLargo_recorta', () => {
    const draft = duplicateDraftOf(task({ goal: 'g' }), 'x'.repeat(90));

    expect(draft.name).toHaveLength(80);
    expect(draft).toMatchObject({ goal: 'g', folders: ['/f'], schedule: null });
  });
});

describe('desktopTaskOf', () => {
  it('desktopTaskOf_conFrontmatter_nombreDescripcionYPrompt', () => {
    const view = desktopTaskOf({ accountDir: '/c', folder: 'say-hello', content: '---\nname: say-hello\ndescription: Activate rutine\n---\n\nSay .' });

    expect(view).toEqual({ key: '/c\nsay-hello', accountDir: '/c', name: 'say-hello', description: 'Activate rutine', promptPreview: 'Say .' });
  });
  it('desktopTaskOf_sinFrontmatter_nombreDeLaCarpeta', () => {
    const view = desktopTaskOf({ accountDir: '/c', folder: 'carpeta', content: 'solo prompt' });

    expect(view).toMatchObject({ name: 'carpeta', description: '', promptPreview: 'solo prompt' });
  });
  it('desktopTaskOf_promptLargo_recortaConPuntos', () => {
    const view = desktopTaskOf({ accountDir: '/c', folder: 'f', content: 'x'.repeat(400) });

    expect(view.promptPreview).toHaveLength(280);
    expect(view.promptPreview.endsWith('…')).toBe(true);
  });
});

describe('filterDesktopTasks', () => {
  it('filterDesktopTasks_porDescripcion', () => {
    const items = [desktopTaskOf({ accountDir: '/c', folder: 'a', content: '---\nname: a\ndescription: Activate\n---\nx' }), desktopTaskOf({ accountDir: '/c', folder: 'b', content: 'otra' })];

    expect(filterDesktopTasks(items, 'activ').map((i) => i.name)).toEqual(['a']);
    expect(filterDesktopTasks(items, '')).toEqual(items);
  });
});

describe('desktopRunsOf', () => {
  const entry = (sessionId: string, title: string, isScheduled: boolean, updatedAtMs: number) => ({
    accountId: 'acc',
    item: { sessionId, configDir: '.claude', cwd: '/w', title, updatedAtMs, sizeBytes: 1, isScheduled } as ConversationSummary,
  });

  it('desktopRunsOf_soloLasProgramadasConEseNombre_ordenadas', () => {
    const history = [entry('a', 'say-hello', true, 1), entry('b', 'say-hello', false, 9), entry('c', 'say-hello', true, 5), entry('d', 'otra', true, 7)];

    expect(desktopRunsOf(history, 'say-hello').map((e) => e.item.sessionId)).toEqual(['c', 'a']);
  });
  it('desktopRunsOf_masDelLimite_recorta', () => {
    const history = [1, 2, 3, 4].map((n) => entry(`s${n}`, 'n', true, n));

    expect(desktopRunsOf(history, 'n')).toHaveLength(3);
  });
});
