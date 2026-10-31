import { describe, expect, it, vi } from 'vitest';
import { localized } from '@shared/i18n/localizedText';
import { showStartupWarnings } from './startupWarnings';

const WARNING = { id: 'linux-no-sandbox', title: localized('notifications.startup.noSandbox.title'), body: localized('notifications.startup.noSandbox.body') };

describe('showStartupWarnings', () => {
  it('showStartupWarnings_unAviso_persistenteConSuClaveYSuTexto', async () => {
    const notify = vi.fn();

    await showStartupWarnings({ fetchWarnings: () => Promise.resolve([WARNING]), notify, reportError: vi.fn() });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mage se ha iniciado sin el sandbox de Chromium', timeoutMs: null, dedupeKey: 'startup:linux-no-sandbox', source: 'startup' }));
  });

  it('showStartupWarnings_avisoLocalizado_notificaEnCastellano', async () => {
    const notify = vi.fn();
    const warning = { id: 'host-unavailable', title: localized('notifications.startup.hostUnavailable.title'), body: localized('notifications.startup.hostUnavailable.body', { reason: 'EADDRINUSE' }) };

    await showStartupWarnings({ fetchWarnings: () => Promise.resolve([warning]), notify, reportError: vi.fn() });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'El host local de Mage no ha arrancado', body: expect.stringMatching(/Motivo: EADDRINUSE$/) }));
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
