import { describe, expect, it } from 'vitest';
import type { TaskSchedule } from '@shared/taskSchedule';
import { defaultScheduleForm, formFromSchedule, scheduleFromForm, type ScheduleForm } from './taskScheduleForm';

const MADRID = 'Europe/Madrid';
const NOW = Date.parse('2026-06-10T10:00:00Z'); // miércoles
const form = (over: Partial<ScheduleForm> = {}): ScheduleForm => ({ ...defaultScheduleForm(NOW, MADRID), ...over });

describe('scheduleFromForm', () => {
  it('scheduleFromForm_semanalCompleta_programacion', () => {
    expect(scheduleFromForm(form({ kind: 'weekly', weekday: '3', time: '10:30' }), MADRID)).toEqual({
      kind: 'weekly', weekday: 3, time: { hour: 10, minute: 30 }, timeZone: MADRID,
    });
  });
  it('scheduleFromForm_horaVacia_null', () => {
    expect(scheduleFromForm(form({ kind: 'daily', time: '' }), MADRID)).toBeNull();
  });
  it('scheduleFromForm_minuto60_null', () => {
    expect(scheduleFromForm(form({ kind: 'hourly', minute: '60' }), MADRID)).toBeNull();
  });
  it('scheduleFromForm_minutoVacio_null', () => {
    expect(scheduleFromForm(form({ kind: 'hourly', minute: '' }), MADRID)).toBeNull();
  });
});

describe('formFromSchedule', () => {
  it('formFromSchedule_idaYVuelta_mismaProgramacion', () => {
    const schedules: TaskSchedule[] = [
      { kind: 'once', date: '2026-07-01', time: { hour: 12, minute: 5 }, timeZone: MADRID },
      { kind: 'hourly', minute: 15, timeZone: MADRID },
      { kind: 'daily', time: { hour: 9, minute: 0 }, timeZone: MADRID },
      { kind: 'weekdays', time: { hour: 8, minute: 45 }, timeZone: MADRID },
      { kind: 'weekly', weekday: 0, time: { hour: 10, minute: 0 }, timeZone: MADRID },
    ];

    for (const schedule of schedules) {
      expect(scheduleFromForm(formFromSchedule(schedule, NOW, MADRID), MADRID)).toEqual(schedule);
    }
  });
});

describe('defaultScheduleForm', () => {
  it('defaultScheduleForm_fechaEsManana', () => {
    expect(defaultScheduleForm(NOW, MADRID)).toEqual({ kind: 'daily', date: '2026-06-11', time: '09:00', minute: '0', weekday: '3' });
  });
});
