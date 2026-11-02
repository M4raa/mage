import { describe, expect, it } from 'vitest';
import { formatClockTime, formatDateTime, formatDayMonth, formatDecimal, formatInteger, formatWeekdayShort, localizeDecimalPoint } from './format';

const ES = 'es-ES';
const EN = 'en-US';
const NINE_FIVE = new Date(2026, 9, 12, 9, 5).getTime();
// Domingo 11-10-2026 (mediodía, lejos de cualquier cambio de día por zona horaria).
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 11 + i, 12).getTime());

describe('formatInteger', () => {
  it('formatInteger_esES_sinSeparadorEnCuatroCifras', () => {
    expect(formatInteger(1234, ES)).toBe('1234');
  });
  it('formatInteger_esES_puntoDeMiles', () => {
    expect(formatInteger(12345, ES)).toBe('12.345');
  });
  it('formatInteger_enUS_comaDeMiles', () => {
    expect(formatInteger(12345, EN)).toBe('12,345');
  });
  it('formatInteger_noFinito_lanzaConElValor', () => {
    expect(() => formatInteger(Number.NaN, ES)).toThrow('NaN');
  });
});

describe('formatDecimal', () => {
  it('formatDecimal_esES_coma', () => {
    expect(formatDecimal(9.44, 1, ES)).toBe('9,4');
  });
  it('formatDecimal_enUS_punto', () => {
    expect(formatDecimal(9.44, 1, EN)).toBe('9.4');
  });
  it('formatDecimal_decimalesNegativos_lanza', () => {
    expect(() => formatDecimal(1, -1, ES)).toThrow('-1');
  });
});

describe('formatClockTime', () => {
  it('formatClockTime_esES_24h', () => {
    expect(formatClockTime(NINE_FIVE, ES)).toBe('09:05');
  });
  it('formatClockTime_enUS_ampm', () => {
    // Según la versión de ICU el espacio antes de AM es normal o U+202F: se compara con la referencia del motor.
    expect(formatClockTime(NINE_FIVE, EN)).toBe(new Date(NINE_FIVE).toLocaleTimeString(EN, { hour: '2-digit', minute: '2-digit' }));
    expect(formatClockTime(NINE_FIVE, EN)).toMatch(/^09:05\s+AM$/);
  });
});

describe('formatWeekdayShort', () => {
  it('formatWeekdayShort_esES_abreviaturas', () => {
    expect(WEEK.map((ms) => formatWeekdayShort(ms, ES)).join(' ')).toBe('dom lun mar mié jue vie sáb');
  });
  it('formatWeekdayShort_enUS_abreviaturas', () => {
    expect(WEEK.map((ms) => formatWeekdayShort(ms, EN)).join(' ')).toBe('Sun Mon Tue Wed Thu Fri Sat');
  });
});

describe('formatDayMonth', () => {
  it('formatDayMonth_esES_diaMes', () => {
    expect(formatDayMonth(NINE_FIVE, ES)).toBe('12/10');
  });
  it('formatDayMonth_enUS_mesDia', () => {
    expect(formatDayMonth(NINE_FIVE, EN)).toBe('10/12');
  });
});

describe('formatDayMonth con un solo dígito', () => {
  it('formatDayMonth_esES_rellenaDiaYMesDeUnDigito', () => {
    expect(formatDayMonth(new Date(2026, 9, 5, 9, 0).getTime(), ES)).toBe('05/10');
  });
  it('formatDayMonth_enUS_rellenaDiaYMesDeUnDigito', () => {
    expect(formatDayMonth(new Date(2026, 0, 5, 9, 0).getTime(), EN)).toBe('01/05');
  });
});

describe('formatDateTime', () => {
  it('formatDateTime_esES_igualQueToLocaleString', () => {
    expect(formatDateTime(NINE_FIVE, ES)).toBe(new Date(NINE_FIVE).toLocaleString(ES));
  });
});

describe('localizeDecimalPoint', () => {
  it('localizeDecimalPoint_esES_cambiaPuntoPorComa', () => {
    expect(localizeDecimalPoint('12.9', ES)).toBe('12,9');
  });
  it('localizeDecimalPoint_enUS_conservaPunto', () => {
    expect(localizeDecimalPoint('12.9', EN)).toBe('12.9');
  });
  it('localizeDecimalPoint_entero_igual', () => {
    expect(localizeDecimalPoint('245', ES)).toBe('245');
  });
  it('localizeDecimalPoint_negativo_cambiaSeparador', () => {
    expect(localizeDecimalPoint('-0.5', ES)).toBe('-0,5');
  });
  it('localizeDecimalPoint_noEsDecimal_lanzaConElValor', () => {
    expect(() => localizeDecimalPoint('1,2', ES)).toThrow(/1,2/);
    expect(() => localizeDecimalPoint('', ES)).toThrow();
  });
});
