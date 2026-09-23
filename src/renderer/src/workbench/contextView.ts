import type { ContextCategory, ContextUsage } from '@shared/events';
import type { TranscriptEntry } from '@shared/transcripts';
import type { ContextInfo } from './types';

// Mapeo PURO del historial de tokens (TranscriptEntry[]) a las dos vistas de la pestana "Contexto":
// (a) atribucion por categorias (cuanto se gasto en input/output/cache) y (b) evolucion del tamano
// de contexto turno a turno con deteccion de compactacion. Sin efectos ni dependencia de reloj/red:
// opera sobre los datos ya cargados por el transcriptStore.

// ---------------------------------------------------------------------------------------------
// (a) Atribucion por categorias
// ---------------------------------------------------------------------------------------------

export interface TokenCategoryTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalTokens: number; // suma de las cuatro categorias
}

// Suma el uso de tokens de todas las entradas assistant con `tokenUsage`. Las entradas sin uso
// (user/system/metadata/assistant sin usage) se ignoran sin lanzar. Todo entero (se conserva porque
// el saneado ya ocurrio en extractTokenUsage).
export function aggregateTokenUsage(entries: readonly TranscriptEntry[]): TokenCategoryTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;

  for (const entry of entries) {
    const usage = entry.tokenUsage;
    if (usage === null) continue;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheCreationInputTokens += usage.cacheCreationInputTokens;
    cacheReadInputTokens += usage.cacheReadInputTokens;
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

// Clave estable de categoria (para asignar color/orden fijo en la UI, nunca por rango).
export type TokenCategoryKey = 'input' | 'output' | 'cacheCreation' | 'cacheRead';

export interface TokenCategoryShare {
  readonly key: TokenCategoryKey;
  readonly label: string;
  readonly tokens: number;
  readonly pct: number; // % entero [0,100] sobre el total; 0 en todas si el total es 0
}

const CATEGORY_LABELS: Readonly<Record<TokenCategoryKey, string>> = {
  input: 'Entrada',
  output: 'Salida',
  cacheCreation: 'Escritura de caché',
  cacheRead: 'Lectura de caché',
};

// Convierte los totales en 4 barras (orden fijo: input, output, cacheCreation, cacheRead). Si el
// total es 0, todas devuelven pct 0 (evita division por 0; nunca NaN).
export function toTokenCategoryShares(totals: TokenCategoryTotals): readonly TokenCategoryShare[] {
  const rows: readonly { readonly key: TokenCategoryKey; readonly tokens: number }[] = [
    { key: 'input', tokens: totals.inputTokens },
    { key: 'output', tokens: totals.outputTokens },
    { key: 'cacheCreation', tokens: totals.cacheCreationInputTokens },
    { key: 'cacheRead', tokens: totals.cacheReadInputTokens },
  ];
  return rows.map(({ key, tokens }) => ({
    key,
    label: CATEGORY_LABELS[key],
    tokens,
    pct: totals.totalTokens === 0 ? 0 : Math.round((tokens / totals.totalTokens) * 100),
  }));
}

// ---------------------------------------------------------------------------------------------
// (b) Evolucion del contexto + deteccion de compactacion
// ---------------------------------------------------------------------------------------------

export interface ContextSizePoint {
  readonly entryIndex: number; // index del TranscriptEntry (posicion en el archivo)
  readonly timestampMs: number | null;
  // input+cacheCreation+cacheRead: magnitud del contexto vivo para el eje del grafico. NO incluye
  // output (los tokens generados no forman parte del contexto de entrada del siguiente turno).
  readonly contextTokens: number;
  readonly cacheReadInputTokens: number; // serie sobre la que se detecta la compactacion
  readonly isCompaction: boolean;
}

// Umbral de caida relativa de cache_read para marcar una compactacion (40%): tras compactar, la
// caché de lectura del turno cae bruscamente aunque el TOTAL de contexto apenas cambie.
export const COMPACTION_DROP_RATIO = 0.4;

// Construye la serie de tamano de contexto (un punto por entrada assistant con usage) y marca las
// compactaciones. Orden preservado (el archivo ya viene en orden cronologico).
export function buildContextSizeSeries(entries: readonly TranscriptEntry[]): readonly ContextSizePoint[] {
  const points = entries
    .filter((entry): entry is TranscriptEntry & { tokenUsage: NonNullable<TranscriptEntry['tokenUsage']> } => entry.tokenUsage !== null)
    .map((entry) => ({
      entryIndex: entry.index,
      timestampMs: entry.timestampMs,
      contextTokens: entry.tokenUsage.inputTokens + entry.tokenUsage.cacheCreationInputTokens + entry.tokenUsage.cacheReadInputTokens,
      cacheReadInputTokens: entry.tokenUsage.cacheReadInputTokens,
    }));
  return markCompactions(points, COMPACTION_DROP_RATIO);
}

// ---------------------------------------------------------------------------------------------
// (c) Asistente de ventana de contexto (M2.4): aviso por umbral, NO invasivo
// ---------------------------------------------------------------------------------------------

// Ventana de contexto por defecto (Claude, 200k). Base para el % de ocupacion del ultimo turno.
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
// Modelos con ventana de 1M de contexto: sufijo `[1m]` (p.ej. `opus[1m]`, `sonnet[1m]`).
export const MILLION_CONTEXT_WINDOW_TOKENS = 1_000_000;

// Ventana de contexto del modelo: 1M si el id lleva el sufijo [1m]; si no, 200k (Claude estandar).
export function contextWindowForModel(model: string): number {
  return /\[1m\]/i.test(model) ? MILLION_CONTEXT_WINDOW_TOKENS : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

// Formato compacto de tokens (es): <1000 tal cual; miles -> "12,3k"; millones -> "1,2M".
export function formatTokensShort(tokens: number): string {
  const safe = tokens > 0 ? Math.round(tokens) : 0;
  if (safe < 1000) return String(safe);
  if (safe < MILLION_CONTEXT_WINDOW_TOKENS) return `${(safe / 1000).toFixed(1).replace('.', ',')}k`;
  return `${(safe / MILLION_CONTEXT_WINDOW_TOKENS).toFixed(1).replace('.', ',')}M`;
}

// Etiqueta de la ventana ("200k" / "1M") para el footer de contexto.
function formatContextWindow(windowTokens: number): string {
  return windowTokens >= MILLION_CONTEXT_WINDOW_TOKENS
    ? `${Math.round(windowTokens / MILLION_CONTEXT_WINDOW_TOKENS)}M`
    : `${Math.round(windowTokens / 1000)}k`;
}

// Construye la ContextInfo del footer del Inspector desde el tamano de contexto vivo y los tokens de
// salida, para el modelo dado (ventana 200k o 1M). usedPct acotado a [0,100].
export function toContextInfo(contextTokens: number, tokensOut: number, model: string): ContextInfo {
  const windowTokens = contextWindowForModel(model);
  const usedPct = windowTokens <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((contextTokens / windowTokens) * 100)));
  return {
    usedTokens: formatTokensShort(contextTokens),
    maxTokens: formatContextWindow(windowTokens),
    usedPct,
    tokensOut: formatTokensShort(tokensOut),
  };
}
// Construye la ContextInfo a partir del desglose REAL que reporta el CLI (D3), en vez de derivarla de
// la transcripcion. Diferencias medidas contra una sesion real: el CLI cuenta ademas el system prompt,
// las tools, las skills y la memoria (~39k tokens antes del primer mensaje, que el calculo derivado no
// ve) y da la ventana EFECTIVA del modelo (967k medidos, ni los 200k ni el 1M redondo que se adivinan
// por el nombre). Se respeta el `percentage` del CLI: es quien sabe como cuenta su propio buffer de
// autocompactacion. `tokensOut` no viene en el desglose, asi que sigue viniendo de la transcripcion.
export function contextInfoFromUsage(usage: ContextUsage, tokensOut: number): ContextInfo {
  if (usage.maxTokens <= 0) {
    throw new Error(`Ventana de contexto invalida en el desglose del CLI: ${usage.maxTokens}`);
  }
  return {
    usedTokens: formatTokensShort(usage.totalTokens),
    maxTokens: formatContextWindow(usage.maxTokens),
    usedPct: Math.min(100, Math.max(0, Math.round(usage.percentage))),
    tokensOut: formatTokensShort(tokensOut),
  };
}

// Categorias del desglose que SUMAN contexto ocupado, ordenadas de mayor a menor. Se excluye el espacio
// libre (no es ocupacion) y lo diferido (declarado pero no cargado: contarlo como ocupado enganaria).
const FREE_SPACE_CATEGORY = 'Free space';

export function occupiedCategories(usage: ContextUsage): readonly ContextCategory[] {
  return usage.categories
    .filter((category) => !category.isDeferred && category.name !== FREE_SPACE_CATEGORY && category.tokens > 0)
    .slice()
    .sort((a, b) => b.tokens - a.tokens);
}

// Cuantas categorias caben en el desglose corto sin volverse ilegible.
const BREAKDOWN_MAX_CATEGORIES = 4;

// Etiqueta corta del indicador de contexto de la barra de estado (2.8): `ctx 45 %`. Devuelve `null`
// cuando el porcentaje no es un numero utilizable (el CLI aun no ha reportado contexto): el llamador
// NO monta el indicador, porque un `ctx NaN %` es peor que no tener indicador. Se acota a [0,100]: el
// CLI puede reportar por encima de 100 con la autocompactacion pendiente.
export function formatContextShort(usedPct: number): string | null {
  if (!Number.isFinite(usedPct)) return null;
  const clamped = Math.min(100, Math.max(0, Math.round(usedPct)));
  return `ctx ${clamped} %`;
}

// Umbrales de aviso (% de la ventana): a partir de warn se sugiere handoff pronto; a partir de high,
// ya. Constantes con nombre (sin magic numbers).
export const CONTEXT_WARN_PCT = 70;
export const CONTEXT_HIGH_PCT = 90;

export type ContextUsageLevel = 'ok' | 'warn' | 'high';

export interface ContextUsageAdvice {
  readonly pct: number; // ocupacion de la ventana [0,100]
  readonly level: ContextUsageLevel;
}

// Consejo de ocupacion de contexto a partir del tamano vivo (contextTokens del ultimo punto) y la
// ventana del modelo. PURO: no toca la sesion (el "compactar" real se difiere; aqui solo se avisa y
// se sugiere un handoff). % acotado a [0,100]; ventana <= 0 -> nivel ok (evita division por 0).
export function contextUsageAdvice(
  contextTokens: number,
  windowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
): ContextUsageAdvice {
  if (windowTokens <= 0) return { pct: 0, level: 'ok' };
  const raw = Math.round((contextTokens / windowTokens) * 100);
  const pct = Math.min(100, Math.max(0, raw));
  const level: ContextUsageLevel = pct >= CONTEXT_HIGH_PCT ? 'high' : pct >= CONTEXT_WARN_PCT ? 'warn' : 'ok';
  return { pct, level };
}

// Tamano de contexto vivo actual = contextTokens del ultimo punto de la serie (0 si no hay puntos).
export function currentContextTokens(points: readonly ContextSizePoint[]): number {
  return points.length === 0 ? 0 : (points[points.length - 1]?.contextTokens ?? 0);
}

// Marca como compactacion todo punto cuyo cache_read cae por debajo de (1-dropRatio) del punto
// anterior. HALLAZGO VERIFICADO con numeros reales: en una compactacion el TOTAL de contexto apenas
// cambia (incluso sube) — la caida SOLO es visible en cacheReadInputTokens, asi que se compara
// SIEMPRE contra cacheReadInputTokens[i-1], NUNCA contra el total. Comparacion por multiplicacion
// (nunca division): si cacheReadInputTokens[i-1] === 0, no hay caida posible -> no se marca.
export function markCompactions(
  points: readonly Omit<ContextSizePoint, 'isCompaction'>[],
  dropRatio: number = COMPACTION_DROP_RATIO,
): readonly ContextSizePoint[] {
  return points.map((point, i) => {
    const previous = points[i - 1];
    if (previous === undefined) return { ...point, isCompaction: false };
    const threshold = previous.cacheReadInputTokens * (1 - dropRatio);
    return { ...point, isCompaction: point.cacheReadInputTokens < threshold };
  });
}
