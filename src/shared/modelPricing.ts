// Precios de lista por modelo para el coste equivalente de «Cuentas y consumo» (P-039). NO es lo que se paga con una
// suscripción: es lo que costaría ese consumo por la API, para compararlo con el precio del plan.
//
// Fuentes, consultadas el 2026-11-10 (actualizar a mano cuando cambien, con la fecha):
//   - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing (lectura de caché a 0,1× salvo Fable 5.x a
//     0,025× y Opus/Sonnet 5.5 a 0,05×; escritura 1,25× a 5 min y 2× a 1 h; Haiku 5.5 con tramo > 100K de prompt).
//   - OpenAI: https://developers.openai.com/api/docs/pricing (Standard; tramo largo con > 272K de entrada; no cobra la
//     escritura de caché: la entrada en caché es parte de la entrada).
// Un modelo que no está aquí no tiene precio: se enseña «sin precio», nunca 0.
//
// Dinero en enteros: micro-USD por millón de tokens, y la multiplicación en BigInt (tokens × precio pasa de 2^53).
export const PRICES_CHECKED_AT = '2026-11-10';

export interface ModelPrice {
  readonly input: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
  readonly output: number;
}

export interface PricedTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
}

const MICRO_PER_USD = 1_000_000;
const TOKENS_PER_MTOK = 1_000_000n;
// Sufijos de la clave de precio: tramo de contexto largo y modo rápido (precio doble en todo).
export const LONG_TIER_SUFFIX = '#long';
export const FAST_SUFFIX = '#fast';
const FAST_MULTIPLIER = 2;

// $/MTok -> micro-USD/MTok, sin arrastrar decimales de coma flotante (0,125 $ -> 125 000).
const usd = (dollars: number): number => Math.round(dollars * MICRO_PER_USD);

function anthropic(input: number, cacheRead: number, output: number): ModelPrice {
  return { input: usd(input), cacheWrite5m: usd(input * 1.25), cacheWrite1h: usd(input * 2), cacheRead: usd(cacheRead), output: usd(output) };
}

function openai(input: number, cached: number, output: number): ModelPrice {
  return { input: usd(input), cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: usd(cached), output: usd(output) };
}

const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-2': anthropic(8, 0.2, 40),
  'claude-fable-5-1': anthropic(10, 0.25, 50),
  'claude-fable-5': anthropic(10, 1, 50),
  'claude-opus-5-5': anthropic(4, 0.2, 20),
  'claude-opus-5': anthropic(5, 0.5, 25),
  'claude-opus-4-8': anthropic(5, 0.5, 25),
  'claude-opus-4-7': anthropic(5, 0.5, 25),
  'claude-opus-4-6': anthropic(5, 0.5, 25),
  'claude-opus-4-5': anthropic(5, 0.5, 25),
  'claude-sonnet-5-5': anthropic(2, 0.1, 10),
  'claude-sonnet-5': anthropic(2, 0.2, 10),
  'claude-sonnet-4-6': anthropic(3, 0.3, 15),
  'claude-sonnet-4-5': anthropic(3, 0.3, 15),
  'claude-haiku-5-5': anthropic(0.1, 0.01, 0.5),
  [`claude-haiku-5-5${LONG_TIER_SUFFIX}`]: anthropic(0.5, 0.05, 2.5),
  'claude-haiku-4-5': anthropic(1, 0.1, 5),
  'gpt-6.1-sol': openai(2, 0.1, 10),
  [`gpt-6.1-sol${LONG_TIER_SUFFIX}`]: openai(4, 0.2, 15),
  'gpt-6-sol': openai(2, 0.2, 10),
  [`gpt-6-sol${LONG_TIER_SUFFIX}`]: openai(4, 0.4, 15),
  'gpt-6-luna': openai(0.1, 0.01, 0.5),
  [`gpt-6-luna${LONG_TIER_SUFFIX}`]: openai(0.2, 0.02, 0.75),
  'gpt-6-astra': openai(10, 1, 50),
  [`gpt-6-astra${LONG_TIER_SUFFIX}`]: openai(20, 2, 75),
  'gpt-6.1-terra': openai(1, 0.05, 5),
  [`gpt-6.1-terra${LONG_TIER_SUFFIX}`]: openai(2, 0.1, 7.5),
};

// Umbral del tramo largo (tokens de prompt de UNA petición) por familia. Por encima, el precio de su clave `#long`.
const LONG_TIER_FROM: readonly { readonly prefix: string; readonly tokens: number }[] = [
  { prefix: 'claude-haiku-5-5', tokens: 100_000 },
  { prefix: 'gpt-6', tokens: 272_000 },
];

// Id del modelo sin la fecha de la instantánea (`claude-haiku-4-5-20251001` -> `claude-haiku-4-5`).
export function baseModelId(model: string): string {
  return model.replace(/-\d{8}$/, '');
}

// Clave de precio de UNA respuesta: el modelo, su tramo por el tamaño del prompt y si fue en modo rápido.
export function pricingKey(model: string, promptTokens: number, fast: boolean): string {
  if (!Number.isFinite(promptTokens) || promptTokens < 0) throw new Error(`Tokens de prompt no validos: ${promptTokens}`);
  const base = baseModelId(model);
  const long = LONG_TIER_FROM.some((tier) => base.startsWith(tier.prefix) && promptTokens > tier.tokens);
  return `${base}${long ? LONG_TIER_SUFFIX : ''}${fast ? FAST_SUFFIX : ''}`;
}

// Modelo legible de una clave de precio (sin tramo ni modo rápido).
export function modelOfKey(key: string): string {
  return key.split('#')[0] ?? key;
}

export function priceOf(key: string): ModelPrice | null {
  const fast = key.endsWith(FAST_SUFFIX);
  const base = fast ? key.slice(0, -FAST_SUFFIX.length) : key;
  const price = PRICES[base];
  if (price === undefined) return null;
  if (!fast) return price;
  return { input: price.input * FAST_MULTIPLIER, cacheWrite5m: price.cacheWrite5m * FAST_MULTIPLIER, cacheWrite1h: price.cacheWrite1h * FAST_MULTIPLIER, cacheRead: price.cacheRead * FAST_MULTIPLIER, output: price.output * FAST_MULTIPLIER };
}

// Coste en micro-USD de unos tokens con la clave de precio; null si el modelo no tiene precio.
export function costMicroUsd(key: string, tokens: PricedTokens): number | null {
  const price = priceOf(key);
  if (price === null) return null;
  const parts: readonly (readonly [number, number])[] = [
    [tokens.inputTokens, price.input],
    [tokens.outputTokens, price.output],
    [tokens.cacheReadTokens, price.cacheRead],
    [tokens.cacheWrite5mTokens, price.cacheWrite5m],
    [tokens.cacheWrite1hTokens, price.cacheWrite1h],
  ];
  let total = 0n;
  for (const [count, perMTok] of parts) {
    if (!Number.isInteger(count) || count < 0) throw new Error(`Tokens no validos para el coste de ${key}: ${count}`);
    total += BigInt(count) * BigInt(perMTok);
  }
  return Number(total / TOKENS_PER_MTOK);
}
