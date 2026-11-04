import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import type {
  LibraryAccountView,
  LibraryActionResult,
  LibraryBlock,
  LibraryComponentView,
  LibraryEntryView,
  LibraryInstallView,
  LibraryKind,
  LibraryPreviewView,
  LibraryView,
} from '@shared/ipc';

// Lógica pura de la sección «Biblioteca» de Configuración: filtros, acciones de cada ficha y claves del catálogo.

export const KIND_ORDER = ['skill', 'agent', 'mcp', 'hook', 'plugin'] as const;
export type LibraryFilter = 'all' | LibraryKind;
export type CardAction = 'preview' | 'enable' | 'disable' | 'update' | 'remove';

const COMMIT_PREFIX_LENGTH = 7;
const KEY_SEPARATOR = '\u0000';

export function kindFilters(entries: readonly LibraryEntryView[]): readonly LibraryFilter[] {
  return ['all', ...KIND_ORDER.filter((kind) => entries.some((entry) => entry.kind === kind))];
}

export function filterEntries(entries: readonly LibraryEntryView[], filter: LibraryFilter): readonly LibraryEntryView[] {
  return filter === 'all' ? entries : entries.filter((entry) => entry.kind === filter);
}

export function installKey(packageId: string, engine: string, accountDir: string): string {
  return [packageId, engine, accountDir].join(KEY_SEPARATOR);
}

export function indexInstalls(installs: readonly LibraryInstallView[]): ReadonlyMap<string, LibraryInstallView> {
  return new Map(installs.map((install) => [installKey(install.packageId, install.engine, install.accountDir), install]));
}

export function cardActions(install: LibraryInstallView | null): readonly CardAction[] {
  if (install === null) return ['preview'];
  if (!install.enabled) return ['enable', 'remove'];
  return install.updateAvailable ? ['update', 'disable', 'remove'] : ['disable', 'remove'];
}

export function selectedAccount(view: LibraryView, accountDir: string | null): LibraryAccountView | null {
  const chosen = view.accounts.find((account) => account.accountDir === accountDir);
  return chosen ?? view.accounts[0] ?? null;
}

const BLOCK_KEYS = {
  engineNotDeclared: 'library.block.engineNotDeclared',
  platformUnsupported: 'library.block.platformUnsupported',
  needsSecrets: 'library.block.needsSecrets',
  kindNotInstallable: 'library.block.kindNotInstallable',
  codexSkillsUnmeasured: 'library.block.codexSkillsUnmeasured',
} as const satisfies Record<LibraryBlock, MessageKey>;
const RESULT_KEYS = {
  done: 'library.result.done',
  collision: 'library.result.collision',
  modifiedByUser: 'library.result.modifiedByUser',
  rolledBack: 'library.result.rolledBack',
} as const satisfies Record<LibraryActionResult['status'], MessageKey>;
const KIND_KEYS = {
  skill: 'library.kind.skill',
  agent: 'library.kind.agent',
  mcp: 'library.kind.mcp',
  hook: 'library.kind.hook',
  plugin: 'library.kind.plugin',
} as const satisfies Record<LibraryKind, MessageKey>;
const COMPONENT_KEYS = {
  skill: 'library.component.skill',
  agent: 'library.component.agent',
  command: 'library.component.command',
  hook: 'library.component.hook',
  mcp: 'library.component.mcp',
  plugin: 'library.component.plugin',
} as const satisfies Record<LibraryComponentView['kind'], MessageKey>;
const PLATFORM_KEYS: Readonly<Record<string, 'library.platform.win32' | 'library.platform.darwin' | 'library.platform.linux'>> = {
  win32: 'library.platform.win32',
  darwin: 'library.platform.darwin',
  linux: 'library.platform.linux',
};

export const blockKey = (block: LibraryBlock) => BLOCK_KEYS[block];
export const resultKey = (result: LibraryActionResult) => RESULT_KEYS[result.status];
export const kindKey = (kind: LibraryKind) => KIND_KEYS[kind];
export const componentKey = (kind: LibraryComponentView['kind']) => COMPONENT_KEYS[kind];
export const platformKey = (platform: string) => PLATFORM_KEYS[platform] ?? null;

export function shortCommit(commit: string | null): string | null {
  return commit === null ? null : commit.slice(0, COMMIT_PREFIX_LENGTH);
}

// Un MCP con clave (ruta mageMcp) pide un campo por cada clave que declara; el resto no pide ninguno.
export function keyedFieldsFor(preview: Pick<LibraryPreviewView, 'route' | 'block' | 'requiresSecrets'>): readonly string[] {
  return preview.route === 'mageMcp' && preview.block === null ? preview.requiresSecrets : [];
}

// Se puede instalar cuando cada campo tiene algo más que espacios.
export function canInstallKeyed(fields: readonly string[], values: Readonly<Record<string, string>>): boolean {
  return fields.every((field) => (values[field] ?? '').trim().length > 0);
}
