// Frontera IPC de la lista de artifacts: valida con Zod lo que manda el renderer y delega. Solo atiende a cuentas
// que main ya considera de la lista (`artifactAccountIds`): un configDir arbitrario haria que main leyera las
// credenciales de CUALQUIER ruta y usara ese token (mismo motivo que la guarda de `UsageGet`).
import { z } from 'zod';
import { IpcChannel } from '@shared/ipc';
import type { AccountArtifacts, ArtifactPage, ArtifactVisibility } from '@shared/artifactLibrary';
import { ARTIFACT_ID_PATTERN, type ArtifactsService } from './artifactsService';
import type { ArtifactViewer, OpenedArtifact } from './artifactViewer';

export interface ArtifactsIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, arg: unknown) => unknown) => void;
  readonly service: Pick<ArtifactsService, 'page' | 'listAll' | 'visibilityOf'>;
  readonly viewer: Pick<ArtifactViewer, 'open'>;
  // Las cuentas con lista, en este momento (las cuentas cambian mientras Mage corre).
  readonly accountIds: () => readonly string[];
}

const MAX_ACCOUNT_CHARS = 1024;
// El medido tenia 144 caracteres; el tope solo evita que el renderer mande un megabyte.
const MAX_PAGE_TOKEN_CHARS = 2048;
const MAX_PREVIEW_CHARS = 200;

const relSchema = z.union([z.literal('mine'), z.literal('shared')]);
const listSchema = z.object({ refresh: z.boolean() }).strict();
const moreSchema = z
  .object({
    accountId: z.string().min(1).max(MAX_ACCOUNT_CHARS),
    rel: relSchema,
    pageToken: z.string().min(1).max(MAX_PAGE_TOKEN_CHARS),
  })
  .strict();

const MAX_URL_CHARS = 2048;
const visibilitySchema = z
  .object({ accountId: z.string().min(1).max(MAX_ACCOUNT_CHARS), url: z.string().min(1).max(MAX_URL_CHARS) })
  .strict();
const openSchema = z
  .object({ accountId: z.string().min(1).max(MAX_ACCOUNT_CHARS), id: z.string().regex(ARTIFACT_ID_PATTERN) })
  .strict();

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const preview = (JSON.stringify(raw) ?? String(raw)).slice(0, MAX_PREVIEW_CHARS);
  throw new Error(`Petición de artifacts inválida (${result.error.issues.map((i) => i.message).join('; ')}): ${preview}`);
}

// Lanza si la cuenta no es una de las que tienen lista. La exporta el paso que abre un artifact.
export function requireArtifactAccount(deps: Pick<ArtifactsIpcDeps, 'accountIds'>, accountId: string): string {
  if (!deps.accountIds().includes(accountId)) {
    throw new Error(`Cuenta sin lista de artifacts (no es de Claude por suscripción con sesión): ${accountId}`);
  }
  return accountId;
}

export function listArtifacts(deps: ArtifactsIpcDeps, raw: unknown): Promise<readonly AccountArtifacts[]> {
  const { refresh } = parseWith(listSchema, raw);
  return deps.service.listAll(deps.accountIds(), refresh);
}

export function moreArtifacts(deps: ArtifactsIpcDeps, raw: unknown): Promise<ArtifactPage> {
  const { accountId, rel, pageToken } = parseWith(moreSchema, raw);
  requireArtifactAccount(deps, accountId);
  return deps.service.page(accountId, rel, { pageToken, refresh: false });
}

// Una cuenta sin lista (la de clave de API que publico algo) no es un error: no hay visibilidad que enseñar.
export async function artifactVisibility(deps: ArtifactsIpcDeps, raw: unknown): Promise<ArtifactVisibility | null> {
  const { accountId, url } = parseWith(visibilitySchema, raw);
  if (!deps.accountIds().includes(accountId)) return null;
  return deps.service.visibilityOf(accountId, url);
}

export function openArtifactInViewer(deps: ArtifactsIpcDeps, raw: unknown): Promise<OpenedArtifact> {
  const { accountId, id } = parseWith(openSchema, raw);
  requireArtifactAccount(deps, accountId);
  return deps.viewer.open(accountId, id);
}

export function registerArtifactsIpc(deps: ArtifactsIpcDeps): void {
  deps.handle(IpcChannel.ArtifactsList, (_event, arg) => listArtifacts(deps, arg));
  deps.handle(IpcChannel.ArtifactsMore, (_event, arg) => moreArtifacts(deps, arg));
  deps.handle(IpcChannel.ArtifactsOpen, (_event, arg) => openArtifactInViewer(deps, arg));
  deps.handle(IpcChannel.ArtifactsVisibility, (_event, arg) => artifactVisibility(deps, arg));
}
