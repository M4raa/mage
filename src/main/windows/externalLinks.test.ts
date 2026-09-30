import { describe, expect, it, vi } from 'vitest';
import { installExternalLinkHandler, type WindowOpenTarget } from './externalLinks';

type Handler = Parameters<WindowOpenTarget['setWindowOpenHandler']>[0];

function captureHandler(): { readonly target: WindowOpenTarget; readonly handler: () => Handler } {
  let captured: Handler | null = null;
  const target: WindowOpenTarget = {
    setWindowOpenHandler: (handler) => {
      captured = handler;
    },
  };
  return {
    target,
    handler: () => {
      if (captured === null) throw new Error('No se registro ningun manejador');
      return captured;
    },
  };
}

describe('installExternalLinkHandler', () => {
  it('installExternalLinkHandler_httpsUrl_abreEnElNavegadorYNiegaLaVentana', async () => {
    // Arrange
    const { target, handler } = captureHandler();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const logError = vi.fn();
    installExternalLinkHandler(target, { openExternal, logError });

    // Act
    const result = handler()({ url: 'https://github.com/M4raa/mage' });
    await Promise.resolve();

    // Assert
    expect(result).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://github.com/M4raa/mage');
    expect(logError).not.toHaveBeenCalled();
  });

  it('installExternalLinkHandler_urlRechazada_registraElErrorYNiegaLaVentana', async () => {
    // Arrange
    const { target, handler } = captureHandler();
    const openExternal = vi.fn().mockRejectedValue(new Error('Solo se pueden abrir URLs https: "http://x"'));
    const logError = vi.fn();
    installExternalLinkHandler(target, { openExternal, logError });

    // Act
    const result = handler()({ url: 'http://x' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(result).toEqual({ action: 'deny' });
    expect(logError).toHaveBeenCalledWith('Solo se pueden abrir URLs https: "http://x"', 'http://x');
  });
});
