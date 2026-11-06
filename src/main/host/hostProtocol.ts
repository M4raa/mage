import { z } from 'zod';
import type { MageEvent } from '@shared/events';
import { UI_LANGUAGES } from '@shared/i18n/language';
import { renderLocalized, type LocalizedText } from '@shared/i18n/localizedText';
import type { Translate } from '@shared/i18n/translator';
import { ELICITATION_ANSWER_SCHEMA } from '@shared/elicitation';
import { PERMISSION_MODES } from '@shared/ipc';
import { REWIND_POINT_SCHEMA } from '../coordination/rewindInput';
import { ANSWER_PERMISSION_SCHEMA, SEND_MESSAGE_SCHEMA, SESSION_ID_SCHEMA, MAX_ID_CHARS, MAX_MESSAGE_CHARS, MAX_MODE_CHARS } from '@shared/sessionInput';
import { CHALLENGE_NONCE_BYTES } from './hostToken';

// Protocolo del host local (F2.6): JSON-RPC 2.0 sobre NDJSON.
// Una línea = un mensaje. El primero de cada conexión tiene que ser `hello` con el token y la versión, salvo un
// `host.challenge` previo (F7.1); hasta el `hello` no se atiende nada más. Todo lo que entra se valida con Zod ANTES de tocar el coordinador.

export const HOST_PROTOCOL_MAJOR = 1;
// 1.1 (F3.3): los eventos `notice`, `error` y `queued_message_failed` llevan `localized` (clave y valores) y, para los
// clientes 1.0, su campo de siempre ya traducido en el idioma de main.
// 1.2 (F7): `host.challenge` antes de `hello` y los métodos de la terminal.
// 1.3 (F7): `host.stop`, `accounts.create`, `session.updateQueued` y la notificación `subscription.closed`.
// 1.4 (0.1.4): `session.rewindPoints`, `session.rewindPlan` y `session.rewind` (el orquestador de la ventana).
// 1.5 (0.1.4): `hello.caller` y el túnel MCP `mcp.message` para los clientes `mcp` (D-M5).
// 1.6 (0.1.4): `client.setLanguage` (el idioma del cliente para los mensajes de error) y `error.data.localized`.
export const HOST_PROTOCOL_MINOR = 6;
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
  TrustRequired: -32007,
  Unsupported: -32008,
  UnknownConversation: -32009,
  UnknownAccount: -32010,
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
  // Credencial MCP_CALLER de la sesion que lanzo a un cliente `mcp` (D-M6); los demas clientes no la mandan.
  caller: z.string().regex(/^[0-9a-f]{64}$/).optional(),
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

// Proveedores que la terminal puede lanzar (D2): los de CLI con cuenta. agy y el runtime propio, no.
export const HOST_SESSION_PROVIDERS = ['claude', 'codex'] as const;
export const HOST_OPTION_KEYS = ['model', 'effort', 'permissionMode'] as const;
export type HostOptionKey = (typeof HOST_OPTION_KEYS)[number];
const MAX_PATH_CHARS = 4096;
// Las claves de API reales miden menos de 200 caracteres; el tope solo impide líneas absurdas.
const MAX_API_KEY_CHARS = 4096;
const MAX_ACCOUNT_NAME_CHARS = 128;
const HOST_STOP_SCHEMA = z.object({ force: z.boolean().optional() }).strict().optional();
// Solo cuentas de API: las de suscripción necesitan el login del navegador y se dan de alta en la ventana.
const ACCOUNTS_CREATE_SCHEMA = z.object({
  provider: z.enum(HOST_SESSION_PROVIDERS),
  name: z.string().min(1).max(MAX_ACCOUNT_NAME_CHARS),
  apiKey: z.string().min(1).max(MAX_API_KEY_CHARS),
}).strict();
export type HostAccountCreateRequest = z.infer<typeof ACCOUNTS_CREATE_SCHEMA>;
const hostId = z.string().min(1).max(MAX_ID_CHARS);

const SESSION_CREATE_SCHEMA = z.object({
  commandId: z.string().uuid(),
  provider: z.enum(HOST_SESSION_PROVIDERS),
  accountId: z.string().min(1).max(MAX_PATH_CHARS),
  cwd: z.string().min(1).max(MAX_PATH_CHARS),
  model: z.string().min(1).max(MAX_MODE_CHARS).optional(),
  effort: z.string().max(MAX_MODE_CHARS).optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  // Solo dice que el cliente enseñó el aviso de confianza: NO autoriza nada (decide main).
  trust: z.object({ acknowledged: z.boolean() }).strict(),
}).strict();
export type HostCreateRequest = z.infer<typeof SESSION_CREATE_SCHEMA>;
const SESSION_RESUME_SCHEMA = z.object({ conversationId: hostId }).strict();
// El esfuerzo vacío es «el del modelo»; modelo y modo de permiso no pueden ir vacíos (igual que el IPC).
const SET_OPTION_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA, key: z.enum(HOST_OPTION_KEYS), value: z.string().max(MAX_MODE_CHARS) }).strict()
  .refine((option) => option.key === 'effort' || option.value.length > 0, { message: 'el valor solo puede ir vacío en «effort»', path: ['value'] });
const REWIND_ACTION_SCHEMA = z.enum(['rewind', 'retry']);
const REWIND_POINTS_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA }).strict();
const REWIND_PLAN_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA, point: REWIND_POINT_SCHEMA, action: REWIND_ACTION_SCHEMA }).strict();
// Sin `attachments`: el host no admite adjuntos.
const REWIND_APPLY_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA, point: REWIND_POINT_SCHEMA, action: REWIND_ACTION_SCHEMA, restoreFiles: z.boolean(), saveCopy: z.boolean() }).strict();
const CANCEL_QUEUED_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA, queuedId: hostId }).strict();
const UPDATE_QUEUED_SCHEMA = z.object({ sessionId: SESSION_ID_SCHEMA, queuedId: hostId, text: z.string().min(1).max(MAX_MESSAGE_CHARS) }).strict();
// Un mensaje JSON-RPC de MCP dentro del túnel (1.5): lo valida el transporte del servidor MCP, no el host.
const MCP_MESSAGE_SCHEMA = z.object({ message: z.record(z.unknown()) }).strict();
export const CLIENT_LANGUAGE_SCHEMA = z.object({ language: z.enum(UI_LANGUAGES) }).strict();

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
  'host.info': EMPTY_PARAMS_SCHEMA,
  'projects.list': EMPTY_PARAMS_SCHEMA,
  'accounts.list': EMPTY_PARAMS_SCHEMA,
  'session.create': SESSION_CREATE_SCHEMA,
  'session.resume': SESSION_RESUME_SCHEMA,
  'session.setOption': SET_OPTION_SCHEMA,
  'session.rewindPoints': REWIND_POINTS_SCHEMA,
  'session.rewindPlan': REWIND_PLAN_SCHEMA,
  'session.rewind': REWIND_APPLY_SCHEMA,
  'session.cancelQueued': CANCEL_QUEUED_SCHEMA,
  'session.updateQueued': UPDATE_QUEUED_SCHEMA,
  'host.stop': HOST_STOP_SCHEMA,
  'accounts.create': ACCOUNTS_CREATE_SCHEMA,
  'mcp.message': MCP_MESSAGE_SCHEMA,
  'client.setLanguage': CLIENT_LANGUAGE_SCHEMA,
} as const;
export type HostMethod = keyof typeof HOST_METHOD_SCHEMAS;

export function isHostMethod(method: string): method is HostMethod {
  return Object.prototype.hasOwnProperty.call(HOST_METHOD_SCHEMAS, method);
}

// Métodos con esquema pero sin implementar: responden `Unsupported` y no se anuncian. Hoy, ninguno.
export const UNSUPPORTED_METHODS: ReadonlySet<HostMethod> = new Set<HostMethod>();
export const HOST_CAPABILITIES: readonly HostMethod[] = (Object.keys(HOST_METHOD_SCHEMAS) as HostMethod[]).filter((method) => !UNSUPPORTED_METHODS.has(method));

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
  readonly data?: { readonly localized: LocalizedText };
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

// Notificación aditiva (1.3): la sesión de una suscripción terminó en el host y la suscripción ya no existe.
export const SUBSCRIPTION_CLOSED_NOTIFICATION = 'subscription.closed';
