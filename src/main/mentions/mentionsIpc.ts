import { IpcChannel } from '@shared/ipc';
import type {
  MentionPreview,
  MentionPreviewParams,
  MentionResolution,
  MentionResolveParams,
  MentionSearchParams,
  MentionSearchResult,
} from '@shared/mentions';
import type { IpcRegister } from '../coordination/sessionIpc';
import type { FileIndexService } from './fileIndex';

export interface MentionsIpcDeps {
  readonly handle: IpcRegister;
  readonly index: () => Pick<FileIndexService, 'search'>;
  readonly resolve: (params: MentionResolveParams) => Promise<MentionResolution>;
  readonly preview: (params: MentionPreviewParams) => Promise<MentionPreview>;
}

// El renderer es la frontera: se comprueba que cada campo es del tipo esperado antes de usarlo.
function asObject(arg: unknown, channel: string): Record<string, unknown> {
  if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) throw new Error(`${channel}: se esperaba un objeto, llego ${JSON.stringify(arg)}`);
  return arg as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, field: string, channel: string): string {
  const value = obj[field];
  if (typeof value !== 'string') throw new Error(`${channel}: ${field} debe ser string, llego ${JSON.stringify(value)}`);
  return value;
}

function numberField(obj: Record<string, unknown>, field: string, channel: string): number {
  const value = obj[field];
  if (typeof value !== 'number') throw new Error(`${channel}: ${field} debe ser numero, llego ${JSON.stringify(value)}`);
  return value;
}

export function registerMentionsIpc(deps: MentionsIpcDeps): void {
  deps.handle(IpcChannel.MentionsSearch, (_e, arg): Promise<MentionSearchResult> => {
    const obj = asObject(arg, IpcChannel.MentionsSearch);
    const params: MentionSearchParams = {
      cwd: stringField(obj, 'cwd', IpcChannel.MentionsSearch),
      accountDir: stringField(obj, 'accountDir', IpcChannel.MentionsSearch),
      query: stringField(obj, 'query', IpcChannel.MentionsSearch),
      limit: numberField(obj, 'limit', IpcChannel.MentionsSearch),
    };
    return deps.index().search(params);
  });
  deps.handle(IpcChannel.MentionsResolve, (_e, arg): Promise<MentionResolution> => {
    const obj = asObject(arg, IpcChannel.MentionsResolve);
    // Las refs las valida a fondo `resolveMentions`; aqui solo que sea una lista.
    if (!Array.isArray(obj.refs)) throw new Error(`${IpcChannel.MentionsResolve}: refs debe ser un array, llego ${JSON.stringify(obj.refs)}`);
    return deps.resolve({
      cwd: stringField(obj, 'cwd', IpcChannel.MentionsResolve),
      accountDir: stringField(obj, 'accountDir', IpcChannel.MentionsResolve),
      provider: stringField(obj, 'provider', IpcChannel.MentionsResolve),
      refs: obj.refs,
    });
  });
  deps.handle(IpcChannel.MentionsPreview, (_e, arg): Promise<MentionPreview> => {
    const obj = asObject(arg, IpcChannel.MentionsPreview);
    return deps.preview({
      cwd: stringField(obj, 'cwd', IpcChannel.MentionsPreview),
      accountDir: stringField(obj, 'accountDir', IpcChannel.MentionsPreview),
      absPath: stringField(obj, 'absPath', IpcChannel.MentionsPreview),
    });
  });
}
