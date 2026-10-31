import { z } from 'zod';
import type { MageEvent } from '@shared/events';
import { renderLocalized } from '@shared/i18n/localizedText';
import type { Translate } from '@shared/i18n/translator';
import { ELICITATION_ANSWER_SCHEMA } from '@shared/elicitation';
import { ANSWER_PERMISSION_SCHEMA, SEND_MESSAGE_SCHEMA, SESSION_ID_SCHEMA, MAX_ID_CHARS } from '@shared/sessionInput';
import { CHALLENGE_NONCE_BYTES } from './hostToken';

// Protocolo del host local (F2.6, §2 de INFORME-019 con las enmiendas H6, H2 y H3): JSON-RPC 2.0 sobre NDJSON.
// Una línea = un mensaje. El primero de cada conexión tiene que ser `hello` con el token y la versión, salvo un
// `host.challenge` previo (F7.1); hasta el `hello` no se atiende nada más. Todo lo que entra se valida con Zod ANTES de tocar el coordinador.

export const HOST_PROTOCOL_MAJOR = 1;
// 1.1 (F3.3): los eventos `notice`, `error` y `queued_message_failed` llevan `localized` (clave y valores) y, para los
// clientes 1.0, su campo de siempre ya traducido en el idioma de main.
// 1.2 (F7): `host.challenge` antes de `hello` y los métodos de la terminal.
export const HOST_PROTOCOL_MINOR = 2;
export const HOST_PROTOCOL = `${HOST_PROTOCOL_MAJOR}.${HOST_PROTOCOL_MINOR}`;

// Códigos JSON-RPC estándar (-32700…-32603) y propios (-32001…-32099).
export const HostErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
  NotAuthenticated: -32001,
  BadToken: -32002,
  ProtocolMismatch: -32003,
  UnknownSession: -32004,
  LineTooLong: -32005,
  SlowConsumer: -32006,
} as const;

const MAX_METHOD_CHARS = 64;
const MAX_TOKEN_CHARS = 256;
const MAX_VERSION_CHARS = 64;

export const REQUEST_ENVELOPE_SCHEMA = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().max(MAX_ID_CHARS), z.number().int()]).optional(),
  method: z.string().min(1).max(MAX_METHOD_CHARS),
  params: z.unknown().optional(),
}).strict();
export type RequestEnvelope = z.infer<typeof REQUEST_ENVELOPE_SCHEMA>;
export type RequestId = string | number;

export const HELLO_PARAMS_SCHEMA = z.object({
  protocol: z.string().regex(/^\d+\.\d+$/, 'se esperaba «major.minor»'),
  client: z.object({ kind: z.enum(['terminal', 'mcp', 'widget']), version: z.string().max(MAX_VERSION_CHARS) }).strict(),
  token: z.string().min(1).max(MAX_TOKEN_CHARS),
}).strict();
export type HelloParams = z.infer<typeof HELLO_PARAMS_SCHEMA>;

// Único método admitido ANTES de `hello` (F7.1): el cliente verifica al host sin enviarle el token.
export const CHALLENGE_METHOD = 'host.challenge';
export const CHALLENGE_PARAMS_SCHEMA = z.object({
  nonce: z.string().regex(new RegExp(`^[0-9a-f]{${CHALLENGE_NONCE_BYTES * 2}}$`), `se esperaban ${CHALLENGE_NONCE_BYTES * 2} caracteres hexadecimales en minúscula`),
}).strict();

const EMPTY_PARAMS_SCHEMA = z.object({}).strict().optional();
// El host v1 no admite adjuntos: una imagen en base64 no cabe en una línea de tamaño razonable.
const HOST_SEND_SCHEMA = SEND_MESSAGE_SCHEMA.omit({ attachments: true });
const SESSION_TARGET_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA }).strict();
const UNSUBSCRIBE_SCHEMA = z.object({ subscriptionId: z.string().min(1).max(MAX_ID_CHARS) }).strict();

// Esquema de los parámetros de cada método posterior al `hello`.
export const HOST_METHOD_SCHEMAS = {
  'sessions.list': EMPTY_PARAMS_SCHEMA,
  'session.snapshot': SESSION_TARGET_SCHEMA,
  'session.subscribe': SESSION_TARGET_SCHEMA,
  'session.unsubscribe': UNSUBSCRIBE_SCHEMA,
  'session.send': HOST_SEND_SCHEMA,
  'session.interrupt': SESSION_TARGET_SCHEMA,
  'session.answerPermission': ANSWER_PERMISSION_SCHEMA,
  'session.answerElicitation': ELICITATION_ANSWER_SCHEMA,
} as const;
export type HostMethod = keyof typeof HOST_METHOD_SCHEMAS;

export function isHostMethod(method: string): method is HostMethod {
  return Object.prototype.hasOwnProperty.call(HOST_METHOD_SCHEMAS, method);
}

export const HOST_CAPABILITIES: readonly HostMethod[] = Object.keys(HOST_METHOD_SCHEMAS) as HostMethod[];

// La versión MAYOR distinta se rechaza; la menor se tolera en los dos sentidos.
export function protocolMismatch(requested: string): string | null {
  const major = Number(requested.split('.')[0]);
  if (major === HOST_PROTOCOL_MAJOR) return null;
  return `El host habla el protocolo ${HOST_PROTOCOL} y el cliente pidió ${requested}: la versión mayor es distinta. Actualiza el cliente o Mage.`;
}

// El evento tal como sale al cliente del host: `localized` (1.1) MAS el campo de siempre (`text`, `message` o `error`)
// ya traducido, para que un cliente 1.0 siga leyendo lo suyo. Los demas eventos no cambian.
export function withLegacyText(event: MageEvent, translate: Translate): Record<string, unknown> {
  switch (event.kind) {
    case 'notice':
      return { ...event, text: renderLocalized(translate, event.localized) };
    case 'error':
      return { ...event, message: renderLocalized(translate, event.localized) };
    case 'queued_message_failed':
      return { ...event, error: renderLocalized(translate, event.localized) };
    default:
      return event;
  }
}

export interface HostErrorBody {
  readonly code: number;
  readonly message: string;
}

export function errorResponse(id: RequestId | null, error: HostErrorBody): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`;
}

export function resultResponse(id: RequestId, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`;
}

export function notification(method: string, params: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
}
