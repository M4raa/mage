// F3.4: todo número, hora y fecha que pinta Mage pasa por aquí con el locale de formato resuelto
// (`ResolvedUiLanguage.formatLocale`); nunca el `Intl` por defecto. Funciones PURAS: el locale es siempre explícito.

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

// Crear un `Intl.*Format` cuesta y la lista del historial pinta cientos: una instancia por locale + opciones.
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${locale}${JSON.stringify(options)}`;
  let format = numberFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(cacheKey, format);
  }
  return format;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${locale}${JSON.stringify(options)}`;
  let format = dateFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(cacheKey, format);
  }
  return format;
}

function assertFinite(fn: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${fn}: valor no finito: ${value}`);
}

export function formatInteger(value: number, locale: string): string {
  assertFinite('formatInteger', value);
  return numberFormat(locale, {}).format(value);
}

export function formatDecimal(value: number, fractionDigits: number, locale: string): string {
  assertFinite('formatDecimal', value);
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) throw new Error(`formatDecimal: decimales no válidos: ${fractionDigits}`);
  return numberFormat(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits, useGrouping: false }).format(value);
}

export function formatClockTime(epochMs: number, locale: string): string {
  assertFinite('formatClockTime', epochMs);
  return dateFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(epochMs);
}

export function formatDateTime(epochMs: number, locale: string): string {
  assertFinite('formatDateTime', epochMs);
  return new Date(epochMs).toLocaleString(locale);
}

export function formatWeekdayShort(epochMs: number, locale: string): string {
  assertFinite('formatWeekdayShort', epochMs);
  return dateFormat(locale, { weekday: 'short' }).format(epochMs);
}

export function formatDayMonth(epochMs: number, locale: string): string {
  assertFinite('formatDayMonth', epochMs);
  return dateFormat(locale, { day: '2-digit', month: '2-digit' }).format(epochMs);
}
