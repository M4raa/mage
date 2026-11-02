import * as shared from '@shared/i18n/format';
import { useUiLanguageStore } from './uiLanguage';

// Envoltorio del renderer sobre `@shared/i18n/format`: el locale activo en el momento de pintar (se lee en cada
// llamada, no se captura).
export const activeFormatLocale = (): string => useUiLanguageStore.getState().resolved.formatLocale;

export const formatInteger = (value: number): string => shared.formatInteger(value, activeFormatLocale());
export const formatDecimal = (value: number, fractionDigits: number): string => shared.formatDecimal(value, fractionDigits, activeFormatLocale());
export const formatClockTime = (epochMs: number): string => shared.formatClockTime(epochMs, activeFormatLocale());
export const formatDateTime = (epochMs: number): string => shared.formatDateTime(epochMs, activeFormatLocale());
export const formatWeekdayShort = (epochMs: number): string => shared.formatWeekdayShort(epochMs, activeFormatLocale());
export const formatDayMonth = (epochMs: number): string => shared.formatDayMonth(epochMs, activeFormatLocale());
export const localizeDecimalPoint = (fixed: string): string => shared.localizeDecimalPoint(fixed, activeFormatLocale());
