// El catálogo de la biblioteca viaja dentro de la app, pero se valida igual que si viniera de fuera (frontera): un
// catálogo inválido lanza al cargarlo y lo atrapa un test, nunca un usuario.
import { z } from 'zod';
import catalogJson from './catalog.json';
import eccContentJson from './eccContent.json';
import {
  CAPABILITY_KINDS,
  describeIssues,
  isSafeRelPath,
  parseCapabilityPackage,
  previewValue,
  type CapabilityPackage,
} from '../capabilityPackage';

export const LIBRARY_CATALOG_VERSION = 1;
export const LIBRARY_PLATFORMS = ['win32', 'darwin', 'linux'] as const;
export const LIBRARY_SCOPES = ['user', 'project'] as const;
export const COMPONENT_KINDS = [...CAPABILITY_KINDS, 'command'] as const;
export const COMPONENT_ENGINES = ['claude', 'codex', 'both'] as const;
const LICENSE_FILE = 'LICENSE';
const RETRIEVED_AT = /^\d{4}-\d{2}-\d{2}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const CONTENT_PREFIX = /^[A-Za-z0-9._/-]+\/$/;

export type LibraryPlatform = (typeof LIBRARY_PLATFORMS)[number];
export type LibraryScope = (typeof LIBRARY_SCOPES)[number];
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export type ComponentEngine = (typeof COMPONENT_ENGINES)[number];

// Rechaza fechas con formato correcto pero inexistentes (2026-13-40, 2026-02-30).
function isRealDate(text: string): boolean {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'solo https');
const nonEmpty = z.string().trim().min(1);

const component = z.object({
  engine: z.enum(COMPONENT_ENGINES),
  kind: z.enum(COMPONENT_KINDS),
  count: z.number().int().positive().optional(),
  names: z.array(z.string().min(1)).min(1).optional(),
});

const entrySchema = z.object({
  title: nonEmpty,
  summary: nonEmpty,
  publisher: nonEmpty,
  provenance: z.object({
    repo: httpsUrl,
    ref: nonEmpty,
    commit: z.string().regex(GIT_COMMIT).optional(),
    path: z.string().refine(isSafeRelPath).optional(),
    retrievedAt: z.string().regex(RETRIEVED_AT).refine(isRealDate, 'fecha inexistente'),
  }),
  license: z.object({ spdx: nonEmpty, url: httpsUrl }),
  distribution: z.enum(['copied', 'linked']),
  platforms: z.array(z.enum(LIBRARY_PLATFORMS)).min(1),
  scopes: z.array(z.enum(LIBRARY_SCOPES)).min(1),
  runsCode: z.boolean(),
  components: z.array(component).min(1),
  contentPrefix: z.string().regex(CONTENT_PREFIX).optional(),
  package: z.unknown(),
});

const catalogSchema = z.object({
  version: z.literal(LIBRARY_CATALOG_VERSION),
  entries: z.array(entrySchema).min(1),
});

type RawEntry = z.infer<typeof entrySchema>;
export type LibraryComponent = z.infer<typeof component>;
export type LibraryCatalogEntry = Omit<RawEntry, 'package'> & {
  readonly id: string;
  readonly package: CapabilityPackage;
};

function entryError(id: string, reason: string): Error {
  return new Error(`Catálogo de la biblioteca: ${id}: ${reason}`);
}

function checkUniqueIds(entries: readonly LibraryCatalogEntry[]): void {
  const seen = new Set<string>();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`Catálogo de la biblioteca: id repetido ${id}`);
    seen.add(id);
  }
}

function checkLicense(entry: LibraryCatalogEntry): void {
  if (entry.license.spdx === entry.package.license) return;
  throw entryError(
    entry.id,
    `la licencia de la ficha (${entry.license.spdx}) no es la del paquete (${entry.package.license})`,
  );
}

function checkDistribution(entry: LibraryCatalogEntry): void {
  const { id, distribution, contentPrefix, package: pkg } = entry;
  if (distribution === 'copied' && (contentPrefix === undefined || pkg.files.length === 0)) {
    throw entryError(id, 'lo copiado necesita contentPrefix y ficheros');
  }
  if (distribution === 'linked' && (pkg.files.length > 0 || pkg.native === undefined)) {
    throw entryError(id, 'lo enlazado no lleva ficheros y necesita native');
  }
}

function checkCatalogConsistency(entries: readonly LibraryCatalogEntry[]): void {
  checkUniqueIds(entries);
  for (const entry of entries) {
    checkLicense(entry);
    checkDistribution(entry);
  }
}

export function parseLibraryCatalog(raw: unknown): readonly LibraryCatalogEntry[] {
  const result = catalogSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Catálogo de la biblioteca inválido (${describeIssues(result.error)}): ${previewValue(raw)}`);
  }
  const entries = result.data.entries.map((entry) => {
    const pkg = parseCapabilityPackage(entry.package);
    return { ...entry, id: pkg.id, package: pkg };
  });
  checkCatalogConsistency(entries);
  return entries;
}

let bundledCatalog: readonly LibraryCatalogEntry[] | undefined;

export function loadBundledCatalog(): readonly LibraryCatalogEntry[] {
  bundledCatalog ??= parseLibraryCatalog(catalogJson);
  return bundledCatalog;
}

export interface EccContent {
  readonly license: { readonly text: string };
  readonly files: Readonly<Record<string, string>>;
}

function textOf(entry: LibraryCatalogEntry, content: EccContent, relPath: string): string {
  if (relPath === LICENSE_FILE) return content.license.text;
  const text = content.files[`${entry.contentPrefix}${relPath}`];
  if (text === undefined) throw new Error(`Falta el contenido de ${entry.id}: ${relPath}`);
  return text;
}

// Los bytes que se instalarían de una entrada copiada. Su sha256 lo verifica el instalador contra el paquete.
export function bundledContents(entry: LibraryCatalogEntry, content: EccContent = eccContentJson): ReadonlyMap<string, Buffer> {
  if (entry.distribution !== 'copied') throw new Error(`La entrada ${entry.id} no es contenido copiado`);
  return new Map(
    entry.package.files.map(({ relPath }) => [relPath, Buffer.from(textOf(entry, content, relPath), 'utf8')]),
  );
}
