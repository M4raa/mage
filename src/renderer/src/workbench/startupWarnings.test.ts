import { describe, expect, it, vi } from 'vitest';
import { showStartupWarnings } from './startupWarnings';

const WARNING = { id: 'linux-no-sandbox', title: 'Sin sandbox', body: 'Instala el .deb' };

describe('showStartupWarnings', () => {
  it('showStartupWarnings_unAviso_persistenteConSuClaveYSuTexto', async () => {
    const notify = vi.fn();

    await showStartupWarnings({ fetchWarnings: () => Promise.resolve([WARNING]), notify, reportError: vi.fn() });

    expect(notify).toHaveBeenCalledWith({ level: 'warning', title: 'Sin sandbox', body: 'Instala el .deb', timeoutMs: null, dedupeKey: 'startup:linux-no-sandbox', source: 'startup' });
  });

  it('showStartupWarnings_sinAvisos_noNotifica', async () => {
    const notify = vi.fn();

    await showStartupWarnings({ fetchWarnings: () => Promise.resolve([]), notify, reportError: vi.fn() });

    expect(notify).not.toHaveBeenCalled();
  });

  it('showStartupWarnings_mainFalla_lanzaElErrorVisibleYNoNotificaAvisos', async () => {
    const notify = vi.fn();
    const reportError = vi.fn();
    const failure = new Error('IPC roto');

    await showStartupWarnings({ fetchWarnings: () => Promise.reject(failure), notify, reportError });

    expect(reportError).toHaveBeenCalledWith('No se pudieron leer los avisos de inicio', failure, 'startup');
    expect(notify).not.toHaveBeenCalled();
  });
});
