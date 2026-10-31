import * as shared from '@shared/i18n/format';
import { useUiLanguageStore } from './uiLanguage';

// Envoltorio del renderer sobre `@shared/i18n/format`: el locale activo en el momento de pintar (se lee en cada
// llamada, no se captura).
const activeLocale = (): string => useUiLanguageStore.getState().resolved.formatLocale;

export const formatInteger = (value: number): string => shared.formatInteger(value, activeLocale());
export const formatDecimal = (value: number, fractionDigits: number): string => shared.formatDecimal(value, fractionDigits, activeLocale());
export const formatClockTime = (epochMs: number): string => shared.formatClockTime(epochMs, activeLocale());
export const formatDateTime = (epochMs: number): string => shared.formatDateTime(epochMs, activeLocale());
export const formatWeekdayShort = (epochMs: number): string => shared.formatWeekdayShort(epochMs, activeLocale());
export const formatDayMonth = (epochMs: number): string => shared.formatDayMonth(epochMs, activeLocale());
