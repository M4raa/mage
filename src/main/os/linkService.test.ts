import { describe, expect, it, vi } from 'vitest';
import { LinkService, type LinkDeps, type LinkStat } from './linkService';

// Stat de mentira: controla isSymbolicLink/isDirectory por test.
function stat(kind: { symlink?: boolean; directory?: boolean }): LinkStat {
  return {
    isSymbolicLink: () => kind.symlink ?? false,
    isDirectory: () => kind.directory ?? false,
  };
}

function deps(overrides: Partial<LinkDeps>): LinkDeps {
  return {
    platform: 'linux',
    symlink: () => undefined,
    // Por defecto la ruta NO existe (lstat lanza) -> classifyLink devuelve 'missing', que es el caso
    // base de crear un enlace. Los tests que necesitan otro estado inyectan su propio lstat.
    lstat: () => {
      throw new Error('ENOENT');
    },
    realpath: (p) => p,
    exists: () => false,
    mkdir: () => undefined,
    unlink: () => undefined,
    rmdir: () => undefined,
    log: () => undefined,
    ...overrides,
  };
}

describe('LinkService.createDirLink', () => {
  it('createDirLink_emptyArgs_throws', () => {
    const service = new LinkService(deps({}));

    expect(() => service.createDirLink('', '/l')).toThrow(/invalido/i);
    expect(() => service.createDirLink('/t', '')).toThrow(/invalido/i);
  });

  it('createDirLink_windows_usesJunction', () => {
    const symlink = vi.fn();
    const service = new LinkService(deps({ platform: 'win32', symlink, exists: () => false }));

    service.createDirLink('C:\\t', 'C:\\l');

    expect(symlink).toHaveBeenCalledWith('C:\\t', 'C:\\l', 'junction');
  });

  it('createDirLink_posix_usesDirSymlink', () => {
    const symlink = vi.fn();
    const service = new LinkService(deps({ platform: 'linux', symlink, exists: () => false }));

    service.createDirLink('/t', '/l');

    expect(symlink).toHaveBeenCalledWith('/t', '/l', 'dir');
  });

  it('createDirLink_missingTarget_createsIt', () => {
    const mkdir = vi.fn();
    // target no existe (primer exists=false), link tampoco (segundo exists=false).
    const service = new LinkService(deps({ mkdir, exists: () => false, symlink: vi.fn() }));

    service.createDirLink('/t', '/l');

    expect(mkdir).toHaveBeenCalledWith('/t');
  });

  it('createDirLink_missing_createsLinkAndReturnsLink', () => {
    const service = new LinkService(deps({ symlink: vi.fn() }));

    expect(service.createDirLink('/t', '/l')).toBe('link');
  });

  it('createDirLink_alreadyLinkedToTarget_doesNotSymlinkNorWarn', () => {
    const symlink = vi.fn();
    const log = vi.fn();
    // Enlace vivo que resuelve al target correcto -> idempotente y sin ruido.
    const service = new LinkService(
      deps({ lstat: () => stat({ symlink: true }), realpath: (p) => (p === '/l' ? '/t' : p), symlink, log }),
    );

    expect(service.createDirLink('/t', '/l')).toBe('link');
    expect(symlink).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('createDirLink_privateDirReplacedLink_logsWithBothPathsAndReturnsPrivate', () => {
    const symlink = vi.fn();
    const log = vi.fn();
    // El fallo que se persigue: una sesion del CLI convirtio el enlace en un directorio REAL
    // (lstat dice dir y realpath == path). Antes, con `exists`, esto era un no-op indetectable.
    const service = new LinkService(
      deps({ lstat: () => stat({ directory: true }), realpath: (p) => p, symlink, log }),
    );

    const kind = service.createDirLink('/main/sessions', '/private/sessions');

    expect(kind).toBe('private');
    expect(symlink).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const [level, message] = log.mock.calls[0] ?? [];
    expect(level).toBe('warn');
    expect(message).toContain('/private/sessions');
    expect(message).toContain('/main/sessions');
  });

  it('createDirLink_linkPointsToWrongTarget_logsWarning', () => {
    const log = vi.fn();
    // Enlace vivo pero apuntando a otro sitio: classifyLink lo daria por bueno; debe reportarse.
    const service = new LinkService(
      deps({ lstat: () => stat({ symlink: true }), realpath: (p) => (p === '/l' ? '/otro' : p), log }),
    );

    expect(service.createDirLink('/t', '/l')).toBe('link');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toContain('/otro');
  });

  it('createDirLink_realpathThrowsOnLiveLink_logsInsteadOfCrashing', () => {
    const log = vi.fn();
    const service = new LinkService(
      deps({
        lstat: () => stat({ symlink: true }),
        realpath: () => {
          throw new Error('ELOOP');
        },
        log,
      }),
    );

    expect(service.createDirLink('/t', '/l')).toBe('link');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toContain('ELOOP');
  });

  it('createDirLink_pathExistsAsFile_throwsWithPath', () => {
    const symlink = vi.fn();
    // Un FICHERO donde deberia ir la carpeta compartida: classifyLink dice 'missing' (solo reconoce
    // dirs) pero la ruta esta ocupada -> error explicito con la ruta, no un EEXIST sin contexto.
    const service = new LinkService(
      deps({ lstat: () => stat({}), exists: (p) => p === '/l', symlink }),
    );

    expect(() => service.createDirLink('/t', '/l')).toThrow(/\/l/);
    expect(symlink).not.toHaveBeenCalled();
  });
});

describe('LinkService.removeDirLink', () => {
  it('removeDirLink_symlink_callsUnlink', () => {
    const unlink = vi.fn();
    const rmdir = vi.fn();
    const service = new LinkService(deps({ lstat: () => stat({ symlink: true }), unlink, rmdir }));

    service.removeDirLink('/l');

    expect(unlink).toHaveBeenCalledWith('/l');
    expect(rmdir).not.toHaveBeenCalled();
  });

  it('removeDirLink_junctionDir_callsRmdir', () => {
    const unlink = vi.fn();
    const rmdir = vi.fn();
    // junction en Windows: aparece como directorio (no symlink) Y su realpath apunta a otro sitio
    // (el target compartido) -> classifyLink lo detecta como enlace -> rmdir quita solo el enlace.
    const service = new LinkService(
      deps({ lstat: () => stat({ directory: true }), realpath: () => 'C:\\main\\shared', unlink, rmdir }),
    );

    service.removeDirLink('C:\\l');

    expect(rmdir).toHaveBeenCalledWith('C:\\l');
    expect(unlink).not.toHaveBeenCalled();
  });

  it('removeDirLink_privateDir_noopNoRmdir', () => {
    // Dir privado real (no es un enlace: realpath == path) con posible contenido. NO debe hacerse
    // rmdir (daria ENOTEMPTY sobre un dir poblado); se deja para el borrado recursivo de la cuenta.
    const unlink = vi.fn();
    const rmdir = vi.fn();
    const service = new LinkService(
      deps({ lstat: () => stat({ directory: true }), realpath: (p) => p, unlink, rmdir }),
    );

    service.removeDirLink('C:\\l');

    expect(rmdir).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('removeDirLink_missing_noop', () => {
    const unlink = vi.fn();
    const rmdir = vi.fn();
    const service = new LinkService(
      deps({
        lstat: () => {
          throw new Error('ENOENT');
        },
        unlink,
        rmdir,
      }),
    );

    service.removeDirLink('/l');

    expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
  });
});

describe('LinkService.classifyLink', () => {
  it('classifyLink_lstatThrows_returnsMissing', () => {
    const service = new LinkService(
      deps({
        lstat: () => {
          throw new Error('ENOENT');
        },
      }),
    );

    expect(service.classifyLink('/x')).toBe('missing');
  });

  it('classifyLink_symlink_returnsLink', () => {
    const service = new LinkService(deps({ lstat: () => stat({ symlink: true }) }));

    expect(service.classifyLink('/x')).toBe('link');
  });

  it('classifyLink_realDir_returnsPrivate', () => {
    // dir cuyo realpath coincide con la ruta -> es un dir real (privado).
    const service = new LinkService(deps({ lstat: () => stat({ directory: true }), realpath: (p) => p }));

    expect(service.classifyLink('/x')).toBe('private');
  });

  it('classifyLink_junctionDir_returnsLink', () => {
    // dir cuyo realpath apunta a otro sitio (junction de Windows) -> es un enlace.
    const service = new LinkService(
      deps({ lstat: () => stat({ directory: true }), realpath: () => '/real/target' }),
    );

    expect(service.classifyLink('/x')).toBe('link');
  });

  it('classifyLink_notDirNotLink_returnsMissing', () => {
    const service = new LinkService(deps({ lstat: () => stat({}) }));

    expect(service.classifyLink('/x')).toBe('missing');
  });
});
