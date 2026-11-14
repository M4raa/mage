// SKILL.md de una skill de una cuenta de Claude, para su detalle en Capacidades › Skills. Solo lectura y SOLO bajo las raíces
// medidas con Claude Code 2.1.319 (2026-11-14): `<cuenta>/skills/<base>` (a menudo un enlace simbólico del usuario, que se
// sigue), `<carpeta>/.claude/skills/<base>` del proyecto de la última sesión, `<cuenta>/skills/synced/<org>_<usuario>/<base>`
// de la organización y `<installPath>/skills/<s>` de un plugin `p:s` instalado bajo `<cuenta>/plugins`. La ruta la arma main
// con nombres validados; el renderer nunca la manda.
import { isAbsolute, join, relative, sep } from 'node:path';
import type { SkillFileParams, SkillFileView } from '@shared/capabilities';
import { NATIVE_NAME } from '../capabilityPackage';
import type { OverviewFs } from './capabilitiesOverview';
import { pluginInstallPaths } from './pluginFiles';

export const SKILL_FILE = 'SKILL.md';
// Tope de lo que cruza el IPC: el mayor SKILL.md medido pesa 134 680 bytes.
export const SKILL_MAX_BYTES = 256 * 1024;
// `prefijo:base`, cada parte como mucho 128.
export const SKILL_NAME_MAX_CHARS = 257;
const SYNCED_DEPTH = 3; // <org>_<usuario>/<base>/SKILL.md

export interface SkillFileDeps { readonly fs: OverviewFs; readonly projectDir: string | null }

// `p:s` → prefijo p y base s; `s` → sin prefijo. Lanza si alguna parte no es un nombre válido (sin barras ni `..`).
export function splitSkillName(name: string): { readonly prefix: string | null; readonly base: string } {
  const colon = name.indexOf(':');
  const prefix = colon < 0 ? null : name.slice(0, colon);
  const base = colon < 0 ? name : name.slice(colon + 1);
  if (!NATIVE_NAME.test(base) || (prefix !== null && !NATIVE_NAME.test(prefix))) {
    throw new Error(`Nombre de skill invalido: ${JSON.stringify(name)}`);
  }
  return { prefix, base };
}

function isUnder(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

// ponytail: con varias copias sincronizadas de la misma skill gana la primera por ruta; por fecha si alguna vez difieren.
function syncedCandidates(fs: OverviewFs, accountDir: string, base: string): string[] {
  const root = join(accountDir, 'skills', 'synced');
  return fs
    .listFiles(root)
    .filter((path) => {
      const parts = relative(root, path).split(sep);
      return parts.length === SYNCED_DEPTH && parts[1] === base && parts[2] === SKILL_FILE;
    })
    .sort();
}

function pluginRoots(fs: OverviewFs, accountDir: string, plugin: string): readonly string[] {
  const pluginsDir = join(accountDir, 'plugins');
  const installed = join(pluginsDir, 'installed_plugins.json');
  const text = fs.exists(installed) ? fs.readFile(installed).toString('utf8') : null;
  return pluginInstallPaths(text, plugin).filter((path) => isUnder(pluginsDir, path));
}

// Rutas posibles, en orden, del SKILL.md de una skill. Vacío si su origen no da ninguna.
export function skillFileCandidates(deps: SkillFileDeps, params: SkillFileParams): readonly string[] {
  const { prefix, base } = splitSkillName(params.name);
  const under = (dir: string): string => join(dir, base, SKILL_FILE);
  if (params.origin === 'user') return [under(join(params.accountDir, 'skills'))];
  if (params.origin === 'project') return deps.projectDir === null ? [] : [under(join(deps.projectDir, '.claude', 'skills'))];
  if (params.origin === 'organization') return syncedCandidates(deps.fs, params.accountDir, base);
  if (prefix === null) return [];
  return pluginRoots(deps.fs, params.accountDir, prefix).map((root) => under(join(root, 'skills')));
}

export function readSkillFile(deps: SkillFileDeps, params: SkillFileParams): SkillFileView {
  const path = skillFileCandidates(deps, params).find((candidate) => deps.fs.exists(candidate));
  if (path === undefined) return { state: 'missing' };
  // ponytail: se lee entero antes de mirar el tope; con un stat si aparecieran SKILL.md enormes.
  const bytes = deps.fs.readFile(path);
  if (bytes.length > SKILL_MAX_BYTES) return { state: 'too_large', path, sizeBytes: bytes.length };
  return { state: 'ok', path, content: bytes.toString('utf8') };
}
