import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import { ARTIFACT_ID_PATTERN } from './artifactsService';
import type { FrameClient } from './frameClient';

// Lectura de un artifact para enseñarlo dentro de Mage (medido contra el CLI 2.1.319): el «boot»
// `GET /api/frame/<id>?via=model_read&bk=probe` da la version (`ver`), los ficheros y un token de lectura
// (`assetToken`, ~1 h); cada fichero sale de `https://<id>.frame.claudeusercontent.com/_f/<ver>/<fichero>?__frame_t=…`
// SIN OAuth ni cookies. Se guardan en una carpeta de cache por cuenta, id y `ver` bajo los datos de Mage, y el
// navegador aislado la abre como su raiz de ficheros.
//
// SEGURIDAD: del boot solo se usan `ver`, `files`, `title` y, para descargar, `assetToken`. El token, `share_key`,
// `subscriptionToken` y `author` nunca salen de este modulo ni van a un mensaje de error (que solo nombra campos).

export const MAX_ARTIFACT_FILES = 20;
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const BYTES_PER_MIB = 1024 * 1024;
export const ARTIFACT_CACHE_DIR = 'artifact-cache';
const CONTENT_HOST_SUFFIX = 'frame.claudeusercontent.com';
// Una version medida es `\d+-[0-9a-f]+`; se acepta algo mas ancho pero nunca separadores ni `..`.
const VER_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
// Cada segmento de la ruta de un fichero: sin separadores, sin `..` y sin caracteres que Windows no admite.
const FILE_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const PAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm']);
const ACCOUNT_KEY_CHARS = 16;

const BootSchema = z
  .object({
    ver: z.string(),
    assetToken: z.string().min(1),
    title: z.string().nullish().catch(null),
    files: z.array(z.object({ path: z.string() }).passthrough()).min(1),
  })
  .passthrough();

// Lo que se usa del boot. Vive solo en main y solo mientras se descarga.
export interface ArtifactBoot {
  readonly ver: string;
  readonly assetToken: string;
  readonly title: string;
  readonly files: readonly string[];
}

// Lo que sale del lector: la carpeta y la pagina de entrada. Sin ningun token.
export interface CachedArtifact {
  readonly root: string;
  readonly entryPath: string;
  readonly title: string;
}

export function bootPath(id: string): string {
  return `/api/frame/${encodeURIComponent(id)}?via=model_read&bk=probe`;
}

// Valida el boot y se queda con lo que se usa. El error nombra los campos, nunca sus valores (llevan tokens).
export function parseBoot(raw: unknown): ArtifactBoot {
  const parsed = BootSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(raiz)').join(', ');
    throw new Error(`Respuesta de lectura del artifact con forma inesperada en: ${fields}`);
  }
  const { ver, assetToken, title, files } = parsed.data;
  if (!VER_PATTERN.test(ver)) throw new Error(`Version de artifact no valida: ${JSON.stringify(ver)}`);
  return { ver, assetToken, title: title ?? '', files: files.map((file) => file.path) };
}

// Rutas de los ficheros, en segmentos seguros. El primero es la pagina de entrada (como hace el CLI) y tiene que ser
// .html/.htm. Mas de MAX_ARTIFACT_FILES es un error claro, no un recorte silencioso.
export function planArtifactFiles(files: readonly string[]): readonly (readonly string[])[] {
  if (files.length > MAX_ARTIFACT_FILES) {
    throw new UserFacingError(localized('errors.artifacts.tooManyFiles', { count: files.length, max: MAX_ARTIFACT_FILES }));
  }
  const planned = files.map(safeSegmentsOf);
  const entry = files[0];
  if (entry === undefined || !PAGE_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
    throw new UserFacingError(localized('errors.artifacts.notAPage', { file: entry ?? '' }));
  }
  return planned;
}

function safeSegmentsOf(file: string): readonly string[] {
  const segments = file.split('/');
  if (segments.length === 0 || !segments.every((segment) => FILE_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`Ruta de fichero de artifact no valida: ${JSON.stringify(file)}`);
  }
  return segments;
}

// Carpeta de cache de un artifact: <datos de Mage>/artifact-cache/<cuenta>/<id>/<ver>. La cuenta va como hash
// (su config dir es una ruta con separadores); el id y la version ya vienen validados.
export function artifactCacheDir(userDataDir: string, accountId: string, id: string, ver: string): string {
  if (!ARTIFACT_ID_PATTERN.test(id)) throw new Error(`Id de artifact no valido: ${JSON.stringify(id)}`);
  if (!VER_PATTERN.test(ver)) throw new Error(`Version de artifact no valida: ${JSON.stringify(ver)}`);
  const accountKey = createHash('sha256').update(accountId).digest('hex').slice(0, ACCOUNT_KEY_CHARS);
  return path.join(userDataDir, ARTIFACT_CACHE_DIR, accountKey, id, ver);
}

export function contentUrl(id: string, ver: string, segments: readonly string[], assetToken: string): string {
  const filePath = segments.map(encodeURIComponent).join('/');
  return `https://${id}.${CONTENT_HOST_SUFFIX}/_f/${encodeURIComponent(ver)}/${filePath}?__frame_t=${encodeURIComponent(assetToken)}`;
}

export interface ArtifactCacheFs {
  exists(target: string): boolean;
  mkdir(target: string): void;
  writeFile(target: string, bytes: Uint8Array): void;
  rename(from: string, to: string): void;
  rmrf(target: string): void;
}

export interface ArtifactReaderDeps {
  readonly client: Pick<FrameClient, 'getJson' | 'getAsset'>;
  readonly userDataDir: string;
  readonly fs: ArtifactCacheFs;
  readonly newId: () => string;
}

interface DownloadedFile {
  readonly segments: readonly string[];
  readonly bytes: Uint8Array;
}

export class ArtifactReader {
  constructor(private readonly deps: ArtifactReaderDeps) {}

  // Pide el boot (siempre: da la version vigente) y, si esa version no esta ya en la cache, descarga sus ficheros.
  async ensureCached(accountId: string, id: string): Promise<CachedArtifact> {
    if (!ARTIFACT_ID_PATTERN.test(id)) throw new Error(`Id de artifact no valido: ${JSON.stringify(id)}`);
    const boot = parseBoot(await this.deps.client.getJson(accountId, bootPath(id)));
    const files = planArtifactFiles(boot.files);
    const root = artifactCacheDir(this.deps.userDataDir, accountId, id, boot.ver);
    // Una version no cambia: si su carpeta existe, esta completa (se crea de golpe con un rename).
    if (!this.deps.fs.exists(root)) await this.download(id, boot, files, root);
    return { root, entryPath: path.join(root, ...(files[0] ?? [])), title: boot.title };
  }

  private async download(id: string, boot: ArtifactBoot, files: readonly (readonly string[])[], root: string): Promise<void> {
    const downloaded = await this.fetchAll(id, boot, files);
    const staging = `${root}.tmp-${this.deps.newId()}`;
    for (const file of downloaded) {
      const target = path.join(staging, ...file.segments);
      this.deps.fs.mkdir(path.dirname(target));
      this.deps.fs.writeFile(target, file.bytes);
    }
    try {
      this.deps.fs.rename(staging, root);
    } catch (error) {
      // Otra apertura del mismo artifact llego antes: su carpeta vale igual. Cualquier otro fallo se relanza.
      this.deps.fs.rmrf(staging);
      if (!this.deps.fs.exists(root)) throw error;
    }
  }

  // Los ficheros en orden, con un presupuesto TOTAL de MAX_ARTIFACT_BYTES.
  private async fetchAll(id: string, boot: ArtifactBoot, files: readonly (readonly string[])[]): Promise<readonly DownloadedFile[]> {
    const out: DownloadedFile[] = [];
    let remaining = MAX_ARTIFACT_BYTES;
    for (const segments of files) {
      const url = contentUrl(id, boot.ver, segments, boot.assetToken);
      const bytes = await this.deps.client.getAsset(url, remaining, segments.join('/')).catch(toTotalTooLarge);
      remaining -= bytes.byteLength;
      out.push({ segments, bytes });
    }
    return out;
  }
}

// Pasar el tope de un fichero aqui es pasar el del artifact entero: se dice asi.
function toTotalTooLarge(error: unknown): never {
  if (error instanceof UserFacingError && error.localized.key === 'errors.artifacts.tooLarge') {
    throw new UserFacingError(localized('errors.artifacts.totalTooLarge', { limitMib: MAX_ARTIFACT_BYTES / BYTES_PER_MIB }));
  }
  throw error;
}
