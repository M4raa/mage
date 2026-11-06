import type { KeepAliveSettings } from '@shared/settings';

// Politica PURA del keep-alive de la cache de Claude (F4.6, D-K4): dice, con lo que se sabe de una sesion, si hay
// que esperar, enviar ya o no hacer nada. Sin timers ni IO: el coordinador la consulta y ejecuta.

export const KEEP_ALIVE_MARGIN_MS = 60_000; // medido: TTL - 60 s
export const KEEP_ALIVE_FALLBACK_MS = 240_000; // sin TTL: 5 min - 60 s
export const KEEP_ALIVE_PROMPT = 'Responde solo: ok'; // el de la medicion

const MS_PER_HOUR = 3_600_000;
const CLAUDE_PROVIDER_ID = 'claude';

export interface KeepAliveInput {
  readonly settings: KeepAliveSettings;
  readonly provider: string;
  readonly isApiKeyAccount: boolean;
  readonly hasClient: boolean; // pestaña abierta (no en segundo plano)
  readonly busy: boolean; // turno en marcha o requires_action
  readonly queueLength: number;
  readonly pendingCount: number;
  readonly steeringCount: number;
  readonly running: boolean; // ya hay un keep-alive en vuelo
  readonly disabled: boolean; // la sesion lo desactivo (rewind de un KA fallido)
  readonly contextTokens: number | null;
  readonly lastRequestStartMs: number | null; // ultima peticion, real o KA
  readonly lastRealRequestStartMs: number | null; // ultima peticion REAL del usuario
  readonly cacheTtlMs: number | null;
  readonly nowMs: number;
}

export type KeepAliveSkipReason =
  | 'not_claude' | 'disabled_setting' | 'disabled_session' | 'no_client' | 'busy' | 'queue' | 'pending' | 'steering'
  | 'running' | 'no_request' | 'small_context' | 'pause_exceeded';

export type KeepAliveDecision =
  | { readonly kind: 'skip'; readonly reason: KeepAliveSkipReason }
  | { readonly kind: 'wait'; readonly dueAtMs: number }
  | { readonly kind: 'send' };

// Cada cuanto refrescar: el TTL leido menos el margen; sin TTL (o uno que no deja margen), el de respaldo.
export function keepAliveIntervalMs(cacheTtlMs: number | null): number {
  if (cacheTtlMs === null || cacheTtlMs <= KEEP_ALIVE_MARGIN_MS) return KEEP_ALIVE_FALLBACK_MS;
  return cacheTtlMs - KEEP_ALIVE_MARGIN_MS;
}

// Primera condicion que lo impide, en orden; null si ninguna.
function skipReason(input: KeepAliveInput): KeepAliveSkipReason | null {
  const enabled = input.isApiKeyAccount ? input.settings.apiKeyEnabled : input.settings.subscriptionEnabled;
  if (input.provider !== CLAUDE_PROVIDER_ID) return 'not_claude';
  if (!enabled) return 'disabled_setting';
  if (input.disabled) return 'disabled_session';
  if (!input.hasClient) return 'no_client';
  if (input.running) return 'running';
  if (input.busy) return 'busy';
  if (input.queueLength > 0) return 'queue';
  if (input.pendingCount > 0) return 'pending';
  if (input.steeringCount > 0) return 'steering';
  if (input.lastRequestStartMs === null || input.lastRealRequestStartMs === null) return 'no_request';
  if (input.contextTokens === null || input.contextTokens < input.settings.minContextTokens) return 'small_context';
  return null;
}

export function decideKeepAlive(input: KeepAliveInput): KeepAliveDecision {
  const reason = skipReason(input);
  if (reason !== null) return { kind: 'skip', reason };
  // `skipReason` ya descarto los null; se repite para el estrechamiento de tipos.
  if (input.lastRequestStartMs === null || input.lastRealRequestStartMs === null) return { kind: 'skip', reason: 'no_request' };
  const dueAtMs = input.lastRequestStartMs + keepAliveIntervalMs(input.cacheTtlMs);
  if (dueAtMs > input.lastRealRequestStartMs + input.settings.maxPauseHours * MS_PER_HOUR) return { kind: 'skip', reason: 'pause_exceeded' };
  if (input.nowMs < dueAtMs) return { kind: 'wait', dueAtMs };
  return { kind: 'send' };
}
