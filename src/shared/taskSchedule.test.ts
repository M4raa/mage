import { describe, expect, it } from 'vitest';
import { nextRunAt, parseIsoDate, taskScheduleSchema, zonedToUtc, type TaskSchedule } from './taskSchedule';

const MADRID = 'Europe/Madrid';
const utc = (iso: string): number => Date.parse(iso);
const at = (hour: number, minute = 0) => ({ hour, minute });
const daily = (hour: number, minute = 0): TaskSchedule => ({ kind: 'daily', time: at(hour, minute), timeZone: MADRID });

describe('zonedToUtc', () => {
  it('zonedToUtc_horaNormal_restaElDesfase', () => {
    expect(zonedToUtc({ year: 2026, month: 6, day: 10, hour: 9, minute: 0 }, MADRID)).toBe(utc('2026-06-10T07:00:00Z'));
  });
  it('zonedToUtc_huecoDePrimavera_correHaciaDelante', () => {
    expect(zonedToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, MADRID)).toBe(utc('2026-03-29T01:30:00Z'));
  });
  it('zonedToUtc_horaRepetidaDeOtono_laPrimera', () => {
    expect(zonedToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, MADRID)).toBe(utc('2026-10-25T00:30:00Z'));
  });
  it('zonedToUtc_nuevaYork_restaCuatroHorasEnVerano', () => {
    expect(zonedToUtc({ year: 2026, month: 6, day: 10, hour: 9, minute: 0 }, 'America/New_York')).toBe(utc('2026-06-10T13:00:00Z'));
  });
});

describe('nextRunAt diaria', () => {
  it('nextRunAt_diariaAntesDeLaHora_hoy', () => {
    expect(nextRunAt(daily(9), utc('2026-06-10T06:00:00Z'))).toBe(utc('2026-06-10T07:00:00Z'));
  });
  it('nextRunAt_diariaJustoALaHora_manana', () => {
    expect(nextRunAt(daily(9), utc('2026-06-10T07:00:00.000Z'))).toBe(utc('2026-06-11T07:00:00Z'));
  });
  it('nextRunAt_diariaCruzaCambioDePrimavera_mismaHoraDeReloj', () => {
    expect(nextRunAt(daily(9), utc('2026-03-28T08:30:00Z'))).toBe(utc('2026-03-29T07:00:00Z'));
  });
  it('nextRunAt_diariaEnHuecoDePrimavera_unaHoraDespues', () => {
    expect(nextRunAt(daily(2, 30), utc('2026-03-28T12:00:00Z'))).toBe(utc('2026-03-29T01:30:00Z'));
  });
  it('nextRunAt_diariaEnHoraRepetida_laPrimera', () => {
    expect(nextRunAt(daily(2, 30), utc('2026-10-24T12:00:00Z'))).toBe(utc('2026-10-25T00:30:00Z'));
  });
  it('nextRunAt_diariaCambioDeAnio_fechaLocalPorDelante', () => {
    expect(nextRunAt(daily(0, 15), utc('2026-12-31T23:30:00Z'))).toBe(utc('2027-01-01T23:15:00Z'));
  });
});

describe('nextRunAt laborables y semanal', () => {
  it('nextRunAt_laborablesViernesPasada_lunes', () => {
    const schedule: TaskSchedule = { kind: 'weekdays', time: at(9), timeZone: MADRID };
    expect(nextRunAt(schedule, utc('2026-06-12T08:00:00Z'))).toBe(utc('2026-06-15T07:00:00Z'));
  });
  it('nextRunAt_semanalMismoDiaPasada_semanaSiguiente', () => {
    const schedule: TaskSchedule = { kind: 'weekly', weekday: 0, time: at(10), timeZone: MADRID };
    expect(nextRunAt(schedule, utc('2026-06-14T09:00:00Z'))).toBe(utc('2026-06-21T08:00:00Z'));
  });
  it('nextRunAt_semanalOtroDia_esaSemana', () => {
    const schedule: TaskSchedule = { kind: 'weekly', weekday: 3, time: at(10), timeZone: MADRID };
    expect(nextRunAt(schedule, utc('2026-06-15T06:00:00Z'))).toBe(utc('2026-06-17T08:00:00Z'));
  });
  it('nextRunAt_semanalCruzaAnio_viernesSiguiente', () => {
    const schedule: TaskSchedule = { kind: 'weekly', weekday: 5, time: at(8), timeZone: MADRID };
    expect(nextRunAt(schedule, utc('2026-12-31T12:00:00Z'))).toBe(utc('2027-01-01T07:00:00Z'));
  });
});

describe('nextRunAt cada hora', () => {
  const hourly: TaskSchedule = { kind: 'hourly', minute: 15, timeZone: MADRID };
  it('nextRunAt_cadaHoraMinutoPorLlegar_estaHora', () => {
    expect(nextRunAt(hourly, utc('2026-06-10T07:10:00Z'))).toBe(utc('2026-06-10T07:15:00Z'));
  });
  it('nextRunAt_cadaHoraMinutoExacto_horaSiguiente', () => {
    expect(nextRunAt(hourly, utc('2026-06-10T07:15:00.000Z'))).toBe(utc('2026-06-10T08:15:00Z'));
  });
  it('nextRunAt_cadaHoraCruzaCambioDePrimavera', () => {
    expect(nextRunAt(hourly, utc('2026-03-29T00:50:00Z'))).toBe(utc('2026-03-29T01:15:00Z'));
  });
});

describe('nextRunAt una vez', () => {
  const once: TaskSchedule = { kind: 'once', date: '2026-07-01', time: at(12), timeZone: MADRID };
  it('nextRunAt_unaVezFutura_suInstante', () => {
    expect(nextRunAt(once, utc('2026-06-10T00:00:00Z'))).toBe(utc('2026-07-01T10:00:00Z'));
  });
  it('nextRunAt_unaVezPasada_null', () => {
    expect(nextRunAt(once, utc('2026-07-02T00:00:00Z'))).toBeNull();
  });
});

describe('taskScheduleSchema', () => {
  it('taskScheduleSchema_zonaInexistente_falla', () => {
    const result = taskScheduleSchema.safeParse({ kind: 'daily', time: at(9), timeZone: 'Mars/Olympus' });
    expect(result.success).toBe(false);
  });
  it('taskScheduleSchema_hora24_falla', () => {
    expect(taskScheduleSchema.safeParse({ kind: 'daily', time: at(24), timeZone: MADRID }).success).toBe(false);
  });
  it('taskScheduleSchema_fecha30DeFebrero_falla', () => {
    const result = taskScheduleSchema.safeParse({ kind: 'once', date: '2026-02-30', time: at(9), timeZone: MADRID });
    expect(result.success).toBe(false);
  });
  it('taskScheduleSchema_claveDeMas_falla', () => {
    expect(taskScheduleSchema.safeParse({ kind: 'daily', time: at(9), timeZone: MADRID, extra: 1 }).success).toBe(false);
  });
  it('taskScheduleSchema_semanalValida_pasa', () => {
    const input = { kind: 'weekly', weekday: 3, time: at(10), timeZone: MADRID };
    expect(taskScheduleSchema.safeParse(input).success).toBe(true);
  });
});

describe('parseIsoDate', () => {
  it('parseIsoDate_formatoRaro_null', () => {
    expect(parseIsoDate('2026-6-1')).toBeNull();
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
  });
});
