import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LinkKind } from '../os/linkService';
import { linkAgyProfile, type AgyProfileLinksDeps } from './agyProfileLinks';

const PROFILE = join('/data', 'agy-profile');
const HOME = join('/home', 'u');
const MANIFEST = join(PROFILE, '.mage-links.json');

// Disco en memoria: que carpetas existen en la casa, que hay ya en el perfil y que se escribe.
function fakeDeps(options: { homeDirs: readonly string[]; kinds?: Readonly<Record<string, LinkKind>>; manifest?: string | null }) {
  const files = new Map<string, string>();
  if (options.manifest !== undefined && options.manifest !== null) files.set(MANIFEST, options.manifest);
  const kinds = options.kinds ?? {};
  const deps: AgyProfileLinksDeps = {
    links: {
      classifyLink: vi.fn((path: string) => kinds[path] ?? 'missing'),
      createDirLink: vi.fn(() => 'link' as const),
      removeDirLink: vi.fn(),
    },
    isDirectory: (path) => options.homeDirs.includes(path),
    mkdir: vi.fn(),
    rename: vi.fn(),
    readFile: (path) => files.get(path) ?? null,
    writeFile: (path, content) => files.set(path, content),
    now: () => 1700,
    log: vi.fn(),
  };
  return { deps, files };
}

describe('linkAgyProfile', () => {
  it('linkAgyProfile_carpetasQueExisten_lasEnlazaYLasApunta', () => {
    const { deps, files } = fakeDeps({ homeDirs: [join(HOME, '.gemini', 'config'), join(HOME, '.ssh')] });

    const linked = linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: ['.gemini/config', '.ssh'] });

    expect(linked).toEqual(['.gemini/config', '.ssh']);
    expect(deps.links.createDirLink).toHaveBeenCalledWith(join(HOME, '.gemini', 'config'), join(PROFILE, '.gemini', 'config'));
    expect(deps.links.createDirLink).toHaveBeenCalledWith(join(HOME, '.ssh'), join(PROFILE, '.ssh'));
    expect(JSON.parse(files.get(MANIFEST) ?? '')).toEqual(['.gemini/config', '.ssh']);
  });

  // No se crea nada en la casa del usuario: si no tiene `.ssh`, no se enlaza.
  it('linkAgyProfile_carpetaQueNoExisteEnLaCasa_noSeEnlaza', () => {
    const { deps } = fakeDeps({ homeDirs: [join(HOME, '.gemini', 'config')] });

    const linked = linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: ['.gemini/config', '.ssh'] });

    expect(linked).toEqual(['.gemini/config']);
    expect(deps.links.createDirLink).toHaveBeenCalledTimes(1);
  });

  // Medido: con `.gemini/config` colgado agy ni arranca.
  it('linkAgyProfile_enlaceColgado_seQuita', () => {
    const link = join(PROFILE, '.ssh');
    const { deps } = fakeDeps({ homeDirs: [], kinds: { [link]: 'link' } });

    linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: ['.ssh'] });

    expect(deps.links.removeDirLink).toHaveBeenCalledWith(link);
    expect(deps.links.createDirLink).not.toHaveBeenCalled();
  });

  // Medido: agy crea `.gemini/config` como carpeta real al arrancar en un perfil. Se aparta, nunca se borra.
  it('linkAgyProfile_carpetaRealDondeVaElEnlace_seApartaYSeEnlaza', () => {
    const link = join(PROFILE, '.gemini', 'config');
    const { deps } = fakeDeps({ homeDirs: [join(HOME, '.gemini', 'config')], kinds: { [link]: 'private' } });

    linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: ['.gemini/config'] });

    expect(deps.rename).toHaveBeenCalledWith(link, `${link}.mage-1700`);
    expect(deps.links.createDirLink).toHaveBeenCalledWith(join(HOME, '.gemini', 'config'), link);
  });

  it('linkAgyProfile_rutaQueYaNoSePide_quitaSuEnlace', () => {
    const { deps } = fakeDeps({ homeDirs: [join(HOME, '.ssh')], manifest: JSON.stringify(['.ssh', '.aws']) });

    linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: ['.ssh'] });

    expect(deps.links.removeDirLink).toHaveBeenCalledWith(join(PROFILE, '.aws'));
    expect(deps.links.removeDirLink).not.toHaveBeenCalledWith(join(PROFILE, '.ssh'));
  });

  it.each(['{no es json', '{"a":1}'])('linkAgyProfile_listaIlegible_avisaYNoQuitaNada_%#', (manifest) => {
    const { deps } = fakeDeps({ homeDirs: [], manifest });

    linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: [] });

    expect(deps.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ path: MANIFEST }));
    expect(deps.links.removeDirLink).not.toHaveBeenCalled();
  });

  it('linkAgyProfile_sinRutas_escribeListaVacia', () => {
    const { deps, files } = fakeDeps({ homeDirs: [] });

    expect(linkAgyProfile(deps, { profileDir: PROFILE, home: HOME, paths: [] })).toEqual([]);
    expect(JSON.parse(files.get(MANIFEST) ?? '')).toEqual([]);
  });
});
