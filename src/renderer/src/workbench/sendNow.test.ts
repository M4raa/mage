import { describe, expect, it } from 'vitest';
import { localized, renderLocalized } from '@shared/i18n/localizedText';
import { createTranslator } from '@shared/i18n/translator';
import { deliveryNotices, notSteerableText, sendNowAvailability } from './sendNow';

const FREE = { notSteerable: null } as const;

describe('sendNowAvailability', () => {
  it('sendNowAvailability_claudeSinBloqueo_habilitado', () => {
    expect(sendNowAvailability({ provider: 'claude', providerLabel: 'Claude', ...FREE })).toEqual({ enabled: true });
  });

  it('sendNowAvailability_codexSinBloqueo_habilitado', () => {
    expect(sendNowAvailability({ provider: 'codex', providerLabel: 'Codex', ...FREE })).toEqual({ enabled: true });
  });

  it('sendNowAvailability_agy_deshabilitadoConElNombreDelProveedor', () => {
    expect(sendNowAvailability({ provider: 'agy', providerLabel: 'agy', ...FREE })).toEqual({
      enabled: false,
      reason: localized('prompt.sendNow.providerUnsupported', { provider: 'agy' }),
    });
  });

  it('sendNowAvailability_runtimePropio_deshabilitado', () => {
    expect(sendNowAvailability({ provider: 'ollama-local', providerLabel: 'Ollama', ...FREE })).toEqual({
      enabled: false,
      reason: localized('prompt.sendNow.providerUnsupported', { provider: 'Ollama' }),
    });
  });

  it('sendNowAvailability_turnoReview_deshabilitadoConSuTipo', () => {
    expect(sendNowAvailability({ provider: 'claude', providerLabel: 'Claude', notSteerable: 'review' })).toEqual({
      enabled: false,
      reason: localized('chat.steer.notSteerable', { turnKind: 'review' }),
    });
  });
});

describe('deliveryNotices', () => {
  it('deliveryNotices_colaPorCompact_avisoDeCompactacion', () => {
    expect(deliveryNotices({ into: 'queue', late: false, turnKind: 'compact' })).toEqual([notSteerableText('compact')]);
  });

  it('deliveryNotices_turnoNuevoTardio_avisoDeTardio', () => {
    expect(deliveryNotices({ into: 'new_turn', late: true, turnKind: null })).toEqual([localized('chat.steer.late')]);
  });

  it('deliveryNotices_dentroDelTurno_sinAvisos', () => {
    expect(deliveryNotices({ into: 'active_turn', late: false, turnKind: null })).toEqual([]);
  });

  it('deliveryNotices_fallido_sinAvisos', () => {
    expect(deliveryNotices({ into: 'failed', late: false, turnKind: null })).toEqual([]);
  });

  it('deliveryNotices_colaSinTipo_sinAvisos', () => {
    expect(deliveryNotices({ into: 'queue', late: false, turnKind: null })).toEqual([]);
  });
});

describe('notSteerableText', () => {
  it('notSteerableText_seRenderizaEnCastellano', () => {
    const es = createTranslator('es');

    expect(renderLocalized(es, notSteerableText('review'))).toBe('Este turno de revisión no admite mensajes directos: el mensaje espera en la cola.');
    expect(renderLocalized(es, notSteerableText('foo'))).toBe('Este turno no admite mensajes directos: el mensaje espera en la cola.');
  });
});
