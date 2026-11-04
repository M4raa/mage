import { IpcChannel } from '@shared/ipc';
import {
  parsePrKey,
  prKeyToString,
  type MergeStrategy,
  type PrCatalogEntry,
  type PrDetail,
  type PrKey,
  type PrListParams,
  type PrListResult,
  type PrListState,
  type PrMigrateParams,
  type PrWriteAction,
  type PrWriteParams,
  type PrWriteResult,
} from '@shared/pr';
import type { IpcRegister } from '../coordination/sessionIpc';
import type { GhService } from './ghService';
import type { PrCatalogStore } from './prCatalogStore';

// Canales del panel de PR (F5.5). El renderer es la frontera: cada campo se valida antes de usarlo y el error
// lleva el valor recibido. Las claves se normalizan con `parsePrKey`; las carpetas y cuentas las valida
// `assertFolder`, que inyecta main (las mismas reglas que los canales de git y gh).

export interface PrIpcDeps {
  readonly handle: IpcRegister;
  readonly gh: () => Pick<GhService, 'listPrs' | 'prDetail' | 'prDiff' | 'writePr'>;
  readonly catalog: () => Pick<PrCatalogStore, 'list' | 'link' | 'unlink'>;
  readonly migrate: (params: PrMigrateParams) => Promise<string | null>;
  readonly assertFolder: (params: { readonly cwd: string; readonly accountDir: string }) => void;
}

const LIST_STATES: readonly PrListState[] = ['open', 'draft', 'closed', 'merged', 'all'];
const STRATEGIES: readonly MergeStrategy[] = ['merge', 'squash', 'rebase'];
const REVIEW_EVENTS = ['approve', 'request_changes', 'comment'] as const;

type Obj = Record<string, unknown>;

function asObject(arg: unknown, channel: string): Obj {
  if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) throw new Error(`${channel}: se esperaba un objeto, llego ${JSON.stringify(arg)}`);
  return arg as Obj;
}

function str(obj: Obj, field: string, channel: string): string {
  const value = obj[field];
  if (typeof value !== 'string') throw new Error(`${channel}: ${field} debe ser string, llego ${JSON.stringify(value)}`);
  return value;
}

function bool(obj: Obj, field: string, channel: string): boolean {
  const value = obj[field];
  if (typeof value !== 'boolean') throw new Error(`${channel}: ${field} debe ser booleano, llego ${JSON.stringify(value)}`);
  return value;
}

function int(obj: Obj, field: string, channel: string): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${channel}: ${field} debe ser entero, llego ${JSON.stringify(value)}`);
  return value;
}

function oneOf<T extends string>(obj: Obj, field: string, allowed: readonly T[], channel: string): T {
  const value = str(obj, field, channel);
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`${channel}: ${field} debe ser uno de ${allowed.join(', ')}, llego ${JSON.stringify(value)}`);
  return found;
}

// Una clave serializada (`host/owner/repo#n`) valida.
function keyString(text: string, channel: string): string {
  const parsed = parsePrKey(text);
  if (parsed === null) throw new Error(`${channel}: clave de PR no valida: ${JSON.stringify(text)}`);
  return prKeyToString(parsed);
}

// Un `PrKey` por IPC: se reconstruye y compara con lo recibido para que un `/` dentro de un campo no cuele otra clave.
function keyField(obj: Obj, field: string, channel: string): PrKey {
  const raw = asObject(obj[field], `${channel}.${field}`);
  const candidate = { host: str(raw, 'host', channel), owner: str(raw, 'owner', channel), repo: str(raw, 'repo', channel), number: int(raw, 'number', channel) };
  const parsed = parsePrKey(prKeyToString(candidate));
  const exact = parsed !== null && parsed.number === candidate.number && parsed.host === candidate.host.toLowerCase() && parsed.owner === candidate.owner.toLowerCase() && parsed.repo === candidate.repo.toLowerCase();
  if (parsed === null || !exact) throw new Error(`${channel}: clave de PR no valida: ${JSON.stringify(candidate)}`);
  return parsed;
}

function folder(obj: Obj, channel: string, assertFolder: PrIpcDeps['assertFolder']): { cwd: string; accountDir: string } {
  const params = { cwd: str(obj, 'cwd', channel), accountDir: str(obj, 'accountDir', channel) };
  assertFolder(params);
  return params;
}

function parseAction(arg: unknown, channel: string): PrWriteAction {
  const obj = asObject(arg, `${channel}.action`);
  const kind = oneOf(obj, 'kind', ['comment', 'review', 'close', 'reopen', 'merge', 'autoMerge'], channel);
  switch (kind) {
    case 'comment':
      return { kind, body: str(obj, 'body', channel) };
    case 'review':
      return { kind, event: oneOf(obj, 'event', REVIEW_EVENTS, channel), body: str(obj, 'body', channel) };
    case 'merge':
      return { kind, strategy: oneOf(obj, 'strategy', STRATEGIES, channel), deleteBranch: bool(obj, 'deleteBranch', channel) };
    case 'autoMerge':
      return { kind, enabled: bool(obj, 'enabled', channel), strategy: oneOf(obj, 'strategy', STRATEGIES, channel) };
    default:
      return { kind };
  }
}

function parseListParams(arg: unknown, assertFolder: PrIpcDeps['assertFolder']): PrListParams {
  const channel = IpcChannel.PrList;
  const obj = asObject(arg, channel);
  const repo = asObject(obj.repo, `${channel}.repo`);
  const key = keyField({ key: { ...repo, number: 1 } }, 'key', channel);
  return {
    ...folder(obj, channel, assertFolder),
    repo: { host: key.host, owner: key.owner, repo: key.repo },
    state: oneOf(obj, 'state', LIST_STATES, channel),
    limit: int(obj, 'limit', channel),
  };
}

function parseWriteParams(arg: unknown, assertFolder: PrIpcDeps['assertFolder']): PrWriteParams {
  const channel = IpcChannel.PrWrite;
  const obj = asObject(arg, channel);
  return {
    ...folder(obj, channel, assertFolder),
    key: keyField(obj, 'key', channel),
    expectedHeadSha: str(obj, 'expectedHeadSha', channel),
    action: parseAction(obj.action, channel),
  };
}

function parseMigrateParams(arg: unknown, assertFolder: PrIpcDeps['assertFolder']): PrMigrateParams {
  const channel = IpcChannel.PrMigrate;
  const obj = asObject(arg, channel);
  return { ...folder(obj, channel, assertFolder), conversationId: str(obj, 'conversationId', channel), number: int(obj, 'number', channel) };
}

export function registerPrIpc(deps: PrIpcDeps): void {
  const { handle, assertFolder } = deps;
  handle(IpcChannel.PrList, (_e, arg): Promise<PrListResult> => deps.gh().listPrs(parseListParams(arg, assertFolder)));
  handle(IpcChannel.PrDetail, (_e, arg): Promise<PrDetail> => {
    const obj = asObject(arg, IpcChannel.PrDetail);
    const { cwd, accountDir } = folder(obj, IpcChannel.PrDetail, assertFolder);
    return deps.gh().prDetail(cwd, accountDir, keyField(obj, 'key', IpcChannel.PrDetail));
  });
  handle(IpcChannel.PrDiff, (_e, arg) => {
    const obj = asObject(arg, IpcChannel.PrDiff);
    const { cwd, accountDir } = folder(obj, IpcChannel.PrDiff, assertFolder);
    return deps.gh().prDiff(cwd, accountDir, keyField(obj, 'key', IpcChannel.PrDiff));
  });
  handle(IpcChannel.PrWrite, (_e, arg): Promise<PrWriteResult> => deps.gh().writePr(parseWriteParams(arg, assertFolder)));
  handle(IpcChannel.PrCatalogList, (_e, arg): readonly PrCatalogEntry[] => {
    if (arg !== undefined && typeof arg !== 'string') throw new Error(`${IpcChannel.PrCatalogList}: conversationId debe ser string, llego ${JSON.stringify(arg)}`);
    return deps.catalog().list(arg);
  });
  handle(IpcChannel.PrCatalogLink, (_e, arg): void => {
    const obj = asObject(arg, IpcChannel.PrCatalogLink);
    deps.catalog().link({
      key: keyString(str(obj, 'key', IpcChannel.PrCatalogLink), IpcChannel.PrCatalogLink),
      conversationId: str(obj, 'conversationId', IpcChannel.PrCatalogLink),
      primary: bool(obj, 'primary', IpcChannel.PrCatalogLink),
    });
  });
  handle(IpcChannel.PrCatalogUnlink, (_e, arg): void => {
    const obj = asObject(arg, IpcChannel.PrCatalogUnlink);
    deps.catalog().unlink(keyString(str(obj, 'key', IpcChannel.PrCatalogUnlink), IpcChannel.PrCatalogUnlink), str(obj, 'conversationId', IpcChannel.PrCatalogUnlink));
  });
  handle(IpcChannel.PrMigrate, (_e, arg): Promise<string | null> => deps.migrate(parseMigrateParams(arg, assertFolder)));
}
