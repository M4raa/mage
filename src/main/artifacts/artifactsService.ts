import { z } from 'zod';
import type { AccountInfo } from '@shared/accounts';
import type { AccountArtifacts, ArtifactKind, ArtifactPage, ArtifactPageResult, ArtifactRel, ArtifactSummary } from '@shared/artifactLibrary';
import { foreignText, UserFacingError } from '@shared/i18n/localizedText';
import type { FrameClient } from './frameClient';

// Lista de artifacts de cada cuenta de Claude por suscripcion: «Creados» (`rel=mine`) y «Compartidos conmigo»
// (`rel=shared`), pedidos aparte, de `GET /api/frame/artifacts` (medido contra el CLI 2.1.319). Cache de 60 s por
// cuenta y `rel` para la PRIMERA pagina; «Actualizar» la salta y «Cargar más» nunca la usa.
//
// Lo que cruza al renderer lo decide `toArtifactSummary`: ni `owner_account` ni ningun otro campo de la fila.

export const ARTIFACT_LIST_LIMIT = 30;
export const ARTIFACT_LIST_TTL_MS = 60_000;
const LIST_KINDS = 'page,document';
const LIST_SORT = 'last_viewed';
const KNOWN_KINDS: ReadonlySet<string> = new Set<ArtifactKind>(['page', 'document']);
// El id es el «slug»: va en la ruta de la API y como subdominio del host del contenido. Nada fuera de esto.
export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const OPEN_URL_HOST = 'claude.ai';

// Solo los campos que se usan; el resto de la fila pasa sin validar y no sale de aqui. Validacion laxa: el
// protocolo no es un contrato estable (`.catch()` en lo opcional).
const RowSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    rel: z.string().nullish().catch(null),
    title: z.string().nullish().catch(null),
    open_url: z.string().nullish().catch(null),
    audience: z.string().nullish().catch(null),
    sort_time: z.string().nullish().catch(null),
    updated_at: z.string().nullish().catch(null),
    owner_account: z.string().nullish().catch(null),
    soft_deleted: z.boolean().nullish().catch(null),
    outside_organization: z.boolean().nullish().catch(null),
  })
  .passthrough();

const ListSchema = z
  .object({
    artifacts: z.array(z.unknown()).nullish(),
    next_page_token: z.string().nullish().catch(null),
  })
  .passthrough();

// Ruta de una pagina de la lista.
export function listPath(rel: ArtifactRel, pageToken: string | null): string {
  const query = new URLSearchParams({ rel, kind: LIST_KINDS, sort: LIST_SORT, limit: String(ARTIFACT_LIST_LIMIT) });
  if (pageToken !== null) query.set('page_token', pageToken);
  return `/api/frame/artifacts?${query.toString()}`;
}

// Cuentas que tienen lista: las de Claude por suscripcion con sesion. Las de clave de API no tienen OAuth de
// claude.ai: no salen (sin error).
export function artifactAccountIds(accounts: readonly AccountInfo[]): readonly string[] {
  return accounts
    .filter((account) => account.providerId === 'claude' && account.authKind === 'subscription' && account.loginStatus !== 'logged_out')
    .map((account) => account.configDir);
}

// Respuesta de la API -> pagina saneada. Filas `soft_deleted`, de otra clase o sin id valido se descartan, como el CLI.
export function toArtifactPage(accountId: string, rel: ArtifactRel, raw: unknown): ArtifactPage {
  const parsed = ListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Lista de artifacts con forma inesperada (${accountId}, ${rel}): ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const items = (parsed.data.artifacts ?? []).flatMap((row) => {
    const summary = toArtifactSummary(accountId, rel, row);
    return summary === null ? [] : [summary];
  });
  const token = parsed.data.next_page_token;
  return { accountId, rel, items, nextPageToken: typeof token === 'string' && token.length > 0 ? token : null };
}

export function toArtifactSummary(accountId: string, rel: ArtifactRel, raw: unknown): ArtifactSummary | null {
  const parsed = RowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  if (row.soft_deleted === true || !KNOWN_KINDS.has(row.kind) || !ARTIFACT_ID_PATTERN.test(row.id)) return null;
  return {
    accountId,
    id: row.id,
    kind: row.kind as ArtifactKind,
    rel,
    title: row.title ?? '',
    openUrl: claudeUrlOrEmpty(row.open_url),
    audience: row.audience ?? '',
    sortTime: epochMsOrNull(row.sort_time),
    external: row.outside_organization === true,
  };
}

// Solo https://claude.ai/…: la abre el navegador del sistema y no se enlaza nada de otro host.
function claudeUrlOrEmpty(value: string | null | undefined): string {
  if (typeof value !== 'string' || !URL.canParse(value)) return '';
  const url = new URL(value);
  return url.protocol === 'https:' && url.host === OPEN_URL_HOST ? url.href : '';
}

function epochMsOrNull(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export interface ArtifactsServiceDeps {
  readonly client: Pick<FrameClient, 'getJson'>;
  readonly now: () => number;
}

interface CacheEntry {
  readonly at: number;
  readonly page: ArtifactPage;
}

export interface PageRequest {
  readonly pageToken: string | null;
  readonly refresh: boolean;
}

export class ArtifactsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: ArtifactsServiceDeps) {}

  // Una pagina. La primera (sin token) sale de la cache si tiene menos de 60 s y no se pide «Actualizar».
  async page(accountId: string, rel: ArtifactRel, request: PageRequest): Promise<ArtifactPage> {
    if (accountId.trim().length === 0) throw new Error(`Cuenta vacia al listar artifacts: ${JSON.stringify(accountId)}`);
    if (request.pageToken !== null) return this.fetchPage(accountId, rel, request.pageToken);
    const key = `${accountId}\n${rel}`;
    const cached = this.cache.get(key);
    const nowMs = this.deps.now();
    if (!request.refresh && cached !== undefined && nowMs - cached.at < ARTIFACT_LIST_TTL_MS) return cached.page;
    const page = await this.fetchPage(accountId, rel, null);
    this.cache.set(key, { at: nowMs, page });
    return page;
  }

  // Las dos listas de todas las cuentas. Cada lista de cada cuenta falla sola.
  listAll(accountIds: readonly string[], refresh: boolean): Promise<readonly AccountArtifacts[]> {
    return Promise.all(accountIds.map(async (accountId) => {
      const [mine, shared] = await Promise.all([
        this.settle(accountId, 'mine', refresh),
        this.settle(accountId, 'shared', refresh),
      ]);
      return { accountId, mine, shared };
    }));
  }

  private async settle(accountId: string, rel: ArtifactRel, refresh: boolean): Promise<ArtifactPageResult> {
    try {
      return { ok: true, page: await this.page(accountId, rel, { pageToken: null, refresh }) };
    } catch (error) {
      // No se silencia: el error de ESA lista viaja al renderer, que lo enseña junto a la cuenta.
      return { ok: false, error: errorText(error) };
    }
  }

  private async fetchPage(accountId: string, rel: ArtifactRel, pageToken: string | null): Promise<ArtifactPage> {
    const raw = await this.deps.client.getJson(accountId, listPath(rel, pageToken));
    return toArtifactPage(accountId, rel, raw);
  }
}

function errorText(error: unknown): UserFacingError['localized'] {
  if (error instanceof UserFacingError) return error.localized;
  return foreignText(error instanceof Error ? error.message : String(error));
}
