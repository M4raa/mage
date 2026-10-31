import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatWeekdayShort } from '@shared/i18n/format';
import { createTranslator } from '@shared/i18n/translator';
import { useUiLanguageStore } from '../i18n/uiLanguage';
import { formatSize, relativeTime } from './conversationList';
import { formatTokensShort } from './contextView';
import { formatResetAbsolute } from './usageView';

// F3.4: con la interfaz en inglés los formatos siguen el locale activo (en-US); en castellano no cambia nada y eso
// lo cubren los tests existentes de cada módulo.
const SPANISH = { language: 'es', systemLanguage: 'es', formatLocale: 'es-ES' } as const;
const ENGLISH = { language: 'en', systemLanguage: 'en', formatLocale: 'en-US' } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  useUiLanguageStore.setState({ resolved: ENGLISH, t: createTranslator('en') });
});

afterEach(() => {
  useUiLanguageStore.setState({ resolved: SPANISH, t: createTranslator('es') });
});

describe('formatos con la interfaz en inglés', () => {
  it('formatSize_enUS_puntoDecimal', () => {
    expect(formatSize(9626)).toBe('9.4 kB');
  });

  it('formatTokensShort_enUS_puntoDecimal', () => {
    expect(formatTokensShort(12345)).toBe('12.3k');
  });

  it('formatResetAbsolute_enUS_diaEnIngles', () => {
    const now = new Date(2026, 9, 12, 9, 0).getTime();
    const resetsAt = now + 3 * DAY_MS;

    expect(formatResetAbsolute(resetsAt, now, true).startsWith(formatWeekdayShort(resetsAt, 'en-US'))).toBe(true);
  });

  it('relativeTime_enUS_caeAlCastellano', () => {
    const now = Date.now();

    // en.json aún no tiene format.time.*: al compilar cae al texto `es`. Es lo esperado hasta F3.5.
    expect(relativeTime(now - 5 * 60_000, now)).toBe('hace 5 min');
  });
});
