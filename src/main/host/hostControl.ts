import { isAbsolute } from 'node:path';
import type { AccountCreateParams, AccountInfo } from '@shared/accounts';
import type { ConversationId } from '@shared/coordination';
import type { CreateSessionParams } from '@shared/ipc';
import type { ChatProject } from '@shared/settings';
import { TrustRequiredError, UnknownAccountError } from './hostErrors';
import type { HostAccountCreateRequest, HostCreateRequest, HostOptionKey } from './hostProtocol';

// Lo que el host 1.2 (F7.2) hace fuera del coordinador: crear una sesión con la frontera de confianza de main,
// cambiar sus opciones y listar proyectos y cuentas. Toda la E/S llega inyectada desde index.ts; aquí no se lanza
// nada directamente.

export interface HostProject { readonly id: string; readonly name: string; readonly cwd: string | null }
export interface HostAccount { readonly id: string; readonly name: string; readonly provider: AccountInfo['providerId']; readonly billing: AccountInfo['authKind'] }
export interface HostCreateResult { readonly sessionId: string; readonly conversationId: ConversationId | null }

export interface HostControl {
  createSession(request: HostCreateRequest): HostCreateResult;
  setOption(sessionId: string, key: HostOptionKey, value: string): void;
  listProjects(): readonly HostProject[];
  listAccounts(): readonly HostAccount[];
  createApiAccount(request: HostAccountCreateRequest): HostAccount;
  requestQuit(): void;
}

export interface HostOptionSetters {
  setModel(sessionId: string, model: string): void;
  setEffort(sessionId: string, effort: string): void;
  setPermissionMode(sessionId: string, mode: string): void;
}

export interface HostControlDeps {
  readonly listAccounts: () => readonly AccountInfo[];
  readonly listProjects: () => readonly ChatProject[];
  // `defaultModelByProvider` de los ajustes (el esfuerzo va bajo `<proveedor>#effort`).
  readonly defaultModels: () => Readonly<Record<string, string>>;
  // La misma decisión que una pestaña (`isFolderTrusted` de index.ts).
  readonly isTrusted: (cwd: string, accountDir: string) => boolean;
  // El núcleo de `createSessionFromIpc` sin ventana: vuelve a pasar por `assertLaunchable`. Devuelve el sessionId.
  readonly launch: (params: CreateSessionParams) => string;
  readonly conversationIdOf: (sessionId: string) => ConversationId | null;
  readonly options: HostOptionSetters;
  // `ProviderAccounts.create` de main: guarda la clave en la bóveda y nunca la devuelve.
  readonly createAccount: (params: AccountCreateParams) => AccountInfo;
  // Cierra main un poco después de contestar (`HOST_STOP_DELAY_MS`).
  readonly requestQuit: () => void;
}

// Recibos de `session.create` recordados para deduplicar reintentos: los últimos, no todos.
export const MAX_CREATE_RECEIPTS = 100;
export const EFFORT_KEY_SUFFIX = '#effort';

const toHostAccount = (account: AccountInfo): HostAccount => ({ id: account.configDir, name: account.name, provider: account.providerId, billing: account.authKind });
const nonEmpty = (value: string | undefined): string | undefined => (value === undefined || value.length === 0 ? undefined : value);

export function createHostControl(deps: HostControlDeps): HostControl {
  const receipts = new Map<string, HostCreateResult>();
  return {
    createSession: (request) => createOnce(deps, receipts, request),
    setOption: (sessionId, key, value) => applyOption(deps.options, sessionId, key, value),
    listProjects: () => deps.listProjects().map(({ id, name, cwd }) => ({ id, name, cwd })),
    listAccounts: () => deps.listAccounts().map(toHostAccount),
    createApiAccount: (request) => toHostAccount(deps.createAccount({ providerId: request.provider, authKind: 'api-key', name: request.name, apiKey: request.apiKey })),
    requestQuit: () => deps.requestQuit(),
  };
}

function createOnce(deps: HostControlDeps, receipts: Map<string, HostCreateResult>, request: HostCreateRequest): HostCreateResult {
  const previous = receipts.get(request.commandId);
  if (previous !== undefined) return previous;
  const sessionId = deps.launch(resolveLaunchParams(deps, request));
  const result = { sessionId, conversationId: deps.conversationIdOf(sessionId) };
  receipts.set(request.commandId, result);
  if (receipts.size > MAX_CREATE_RECEIPTS) receipts.delete(receipts.keys().next().value as string);
  return result;
}

// Valida la petición y resuelve cuenta, modelo y esfuerzo. La confianza la decide main, nunca `trust.acknowledged`.
function resolveLaunchParams(deps: HostControlDeps, request: HostCreateRequest): CreateSessionParams {
  if (!isAbsolute(request.cwd)) throw new Error(`La carpeta tiene que ser una ruta absoluta: ${request.cwd}`);
  const account = deps.listAccounts().find((a) => a.configDir === request.accountId && a.providerId === request.provider);
  if (account === undefined) throw new UnknownAccountError(request.accountId, request.provider);
  if (request.permissionMode !== undefined && request.provider !== 'claude') {
    throw new Error(`El modo de permiso solo se elige al crear en Claude (pedido en ${request.provider})`);
  }
  const defaults = deps.defaultModels();
  const model = request.model ?? nonEmpty(defaults[request.provider]) ?? nonEmpty(account.defaultModel ?? undefined);
  if (model === undefined) throw new Error(`No hay modelo por defecto para ${request.provider}: indica uno`);
  const effort = request.effort ?? nonEmpty(defaults[`${request.provider}${EFFORT_KEY_SUFFIX}`]);
  if (!deps.isTrusted(request.cwd, account.configDir)) throw new TrustRequiredError(request.cwd);
  return {
    accountDir: account.configDir,
    provider: request.provider,
    cwd: request.cwd,
    model,
    ...(effort === undefined ? {} : { effort }),
    ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }),
  };
}

function applyOption(options: HostOptionSetters, sessionId: string, key: HostOptionKey, value: string): void {
  switch (key) {
    case 'model': return options.setModel(sessionId, value);
    case 'effort': return options.setEffort(sessionId, value);
    case 'permissionMode': return options.setPermissionMode(sessionId, value);
  }
}
