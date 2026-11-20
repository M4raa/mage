import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_VIEWER_SESSION_ID } from '@shared/artifactLibrary';
import type { BrowserHandle } from '../browser/browserRegistry';
import { ArtifactViewer, type ArtifactViewerDeps } from './artifactViewer';

function setup(overrides: Partial<ArtifactViewerDeps> = {}) {
  const handle = { navigate: vi.fn(async () => 'file:///x') } as unknown as BrowserHandle;
  const events: string[] = [];
  const registry = {
    open: vi.fn(() => {
      events.push('open');
      return handle;
    }),
    close: vi.fn(async () => {
      events.push('close');
      return true;
    }),
  };
  const deps: ArtifactViewerDeps = {
    reader: { ensureCached: vi.fn(async () => ({ root: '/cache/a/1', entryPath: '/cache/a/1/index.html', title: 'Informe' })) },
    registry: () => registry,
    createBrowser: vi.fn(() => handle),
    toFileUrl: (filePath) => `file://${filePath}`,
    ...overrides,
  };
  return { viewer: new ArtifactViewer(deps), deps, registry, handle, events };
}

describe('ArtifactViewer', () => {
  it('open_closesPreviousThenOpensAndNavigatesToEntry', async () => {
    // Arrange
    const { viewer, registry, handle, events } = setup();

    // Act
    const opened = await viewer.open('/home/u/.claude', 'id-1');

    // Assert
    expect(opened).toEqual({ title: 'Informe' });
    expect(events).toEqual(['close', 'open']);
    expect(registry.open).toHaveBeenCalledWith(ARTIFACT_VIEWER_SESSION_ID);
    expect(handle.navigate).toHaveBeenCalledWith('file:///cache/a/1/index.html');
    expect(viewer.isOpen()).toBe(true);
  });

  it('createBrowser_usesTheOpenArtifactRoot', async () => {
    // Arrange
    const { viewer, deps } = setup();
    await viewer.open('/home/u/.claude', 'id-1');

    // Act
    viewer.createBrowser('instance-1');

    // Assert
    expect(deps.createBrowser).toHaveBeenCalledWith('instance-1', '/cache/a/1');
  });

  it('createBrowser_withoutArtifact_throws', () => {
    expect(() => setup().viewer.createBrowser('instance-1')).toThrow(/ningun artifact/);
  });

  it('open_readFails_keepsViewerAsItWas', async () => {
    // Arrange
    const { viewer, registry } = setup({ reader: { ensureCached: vi.fn(async () => { throw new Error('401'); }) } });

    // Act + Assert
    await expect(viewer.open('/home/u/.claude', 'id-1')).rejects.toThrow('401');
    expect(registry.close).not.toHaveBeenCalled();
    expect(viewer.isOpen()).toBe(false);
  });

  it('open_twiceWhileDownloading_onlyTheLatestReachesTheView', async () => {
    // Arrange
    let releaseFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const ensureCached = vi.fn(async (_accountId: string, id: string) => {
      if (id === 'slow') await first;
      return { root: `/cache/${id}`, entryPath: `/cache/${id}/index.html`, title: id };
    });
    const { viewer, handle } = setup({ reader: { ensureCached } });

    // Act
    const slow = viewer.open('/home/u/.claude', 'slow');
    await viewer.open('/home/u/.claude', 'fast');
    releaseFirst();
    await slow;

    // Assert
    expect(handle.navigate).toHaveBeenCalledTimes(1);
    expect(handle.navigate).toHaveBeenCalledWith('file:///cache/fast/index.html');
  });

  it('forget_afterOpen_isClosed', async () => {
    // Arrange
    const { viewer } = setup();
    await viewer.open('/home/u/.claude', 'id-1');

    // Act
    viewer.forget();

    // Assert
    expect(viewer.isOpen()).toBe(false);
  });
});
