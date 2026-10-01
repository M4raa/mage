import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { LinkService } from '../os/linkService';

// Carpetas de la casa del usuario enlazadas en el perfil de agy de Mage (grupo E, fase 2): por defecto
// `.gemini/config` (skills, plugins, MCP, proyectos) y `.ssh`, mas las que el usuario añada en Ajustes.
// Solo CARPETAS y con enlace de directorio (junction en Windows, via LinkService): un enlace de FICHERO no
// sobrevive a que su dueño lo reescriba con tmp+rename.
//
// Medido en agy 1.2.14 (`node spike/agy-spike.mjs --profile`):
//   - un MCP de un `.gemini/config` enlazado se ve desde el perfil (`agy mcp list`) y se puede llamar;
//   - agy CREA `.gemini/config` como carpeta real la primera vez que arranca en un perfil (con
//     `.migrated`, un `mcp_config.json` vacio y `projects/`): por eso una carpeta real donde va el enlace
//     se aparta (renombrada, nunca borrada) y se enlaza;
//   - con un `.gemini/config` enlazado a algo que ya no existe agy NO arranca («failed to get/create
//     default project»): un enlace colgado se quita.
// Borrar el perfil entero (una cuenta por clave que se elimina: `rmSync` recursivo) DESENLAZA los
// junctions sin seguirlos: lo de la casa del usuario sobrevive (medido con Node 24).

const MANIFEST_FILE = '.mage-links.json';
const MANIFEST_SCHEMA = z.array(z.string().min(1));

export interface AgyProfileLinksDeps {
  readonly links: Pick<LinkService, 'classifyLink' | 'createDirLink' | 'removeDirLink'>;
  readonly isDirectory: (path: string) => boolean; // sigue enlaces; false si no existe
  readonly mkdir: (path: string) => void;
  readonly rename: (from: string, to: string) => void;
  readonly readFile: (path: string) => string | null; // null = no existe
  readonly writeFile: (path: string, content: string) => void;
  readonly now: () => number;
  readonly log: (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void;
}

export interface AgyProfileLinksInput {
  readonly profileDir: string;
  readonly home: string;
  readonly paths: readonly string[]; // relativas a la casa, con `/` (agyLinkedPaths)
}

// Deja el perfil con exactamente `paths` enlazadas (las que existan en la casa). Quita los enlaces que
// Mage puso antes y ya no se piden. Devuelve las que quedaron enlazadas.
export function linkAgyProfile(deps: AgyProfileLinksDeps, input: AgyProfileLinksInput): readonly string[] {
  const manifestPath = join(input.profileDir, MANIFEST_FILE);
  const wanted = new Set(input.paths);
  for (const stale of readManifest(deps, manifestPath).filter((path) => !wanted.has(path))) {
    deps.links.removeDirLink(join(input.profileDir, ...stale.split('/')));
  }
  const linked = input.paths.filter((path) => linkOne(deps, input, path));
  deps.writeFile(manifestPath, `${JSON.stringify(linked, null, 2)}\n`);
  return linked;
}

function linkOne(deps: AgyProfileLinksDeps, input: AgyProfileLinksInput, path: string): boolean {
  const segments = path.split('/');
  const target = join(input.home, ...segments);
  const link = join(input.profileDir, ...segments);
  const kind = deps.links.classifyLink(link);
  if (!deps.isDirectory(target)) {
    if (kind === 'link') deps.links.removeDirLink(link); // colgado: con .gemini/config agy ni arranca
    return false;
  }
  if (kind === 'private') {
    const aside = `${link}.mage-${deps.now()}`;
    deps.rename(link, aside);
    deps.log('warn', 'El perfil de agy tenía una carpeta real donde va un enlace: se aparta y se enlaza', { link, aside });
  }
  deps.mkdir(dirname(link));
  deps.links.createDirLink(target, link);
  return true;
}

function readManifest(deps: AgyProfileLinksDeps, path: string): readonly string[] {
  const text = deps.readFile(path);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    deps.log('warn', 'Lista de enlaces del perfil de agy ilegible: no se quita ningún enlace antiguo', { path, error: String(err) });
    return [];
  }
  const result = MANIFEST_SCHEMA.safeParse(parsed);
  if (!result.success) deps.log('warn', 'Lista de enlaces del perfil de agy con forma inesperada: se ignora', { path });
  return result.success ? result.data : [];
}
