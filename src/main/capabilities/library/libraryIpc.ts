// Frontera IPC de la biblioteca: valida lo que manda el renderer con Zod y delega en el servicio. Aquí no hay lógica.
import { z } from 'zod';
import { IpcChannel, type LibraryApplyParams, type LibraryTarget } from '@shared/ipc';
import { CAPABILITY_ENGINES, describeIssues, previewValue } from '../capabilityPackage';
import { redactSecrets, SECRET_MAX_CHARS, SECRET_NAME } from './librarySecrets';
import type { LibraryService } from './libraryService';

export interface LibraryIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, arg: unknown) => unknown) => void;
  // Perezoso: depende de `app.getPath('userData')`.
  readonly service: () => LibraryService;
}

const LIBRARY_ACTIONS = ['install', 'enable', 'disable', 'update', 'remove'] as const;

const targetSchema = z.object({
  packageId: z.string().min(1),
  engine: z.enum(CAPABILITY_ENGINES),
  accountDir: z.string().min(1),
});
const applySchema = targetSchema.extend({
  action: z.enum(LIBRARY_ACTIONS),
  secrets: z.record(z.string().regex(SECRET_NAME), z.string().max(SECRET_MAX_CHARS)).optional(),
});

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Petición de la biblioteca inválida (${describeIssues(result.error)}): ${previewValue(redactSecrets(raw))}`);
}

export function parseLibraryTarget(raw: unknown): LibraryTarget {
  return parseWith(targetSchema, raw);
}

export function parseLibraryApplyParams(raw: unknown): LibraryApplyParams {
  return parseWith(applySchema, raw);
}

export function registerLibraryIpc(deps: LibraryIpcDeps): void {
  deps.handle(IpcChannel.LibraryView, () => deps.service().view());
  deps.handle(IpcChannel.LibraryPreview, (_event, arg) => deps.service().preview(parseLibraryTarget(arg)));
  deps.handle(IpcChannel.LibraryApply, (_event, arg) => {
    const { action, secrets, ...target } = parseLibraryApplyParams(arg);
    return deps.service().apply(action, target, secrets);
  });
}
