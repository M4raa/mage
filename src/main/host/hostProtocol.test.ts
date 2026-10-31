import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import { foreignText, localized } from '@shared/i18n/localizedText';
import { createTranslator } from '@shared/i18n/translator';
import { withLegacyText } from './hostProtocol';

const translate = createTranslator('es');
const QUEUED = { id: 'q1', text: 'hola', attachments: [] };

describe('withLegacyText', () => {
  it('withLegacyText_notice_anadeTextTraducidoYConservaLocalized', () => {
    const event: MageEvent = { kind: 'notice', localized: localized('events.runtime.nothingToCompact') };

    expect(withLegacyText(event, translate)).toEqual({ ...event, text: 'No hay nada que compactar todavía.' });
  });

  it('withLegacyText_error_anadeMessageYConservaDeniedCommand', () => {
    const event: MageEvent = { kind: 'error', localized: localized('events.agy.deniedCommandByRule', { command: 'ls' }), deniedCommand: 'ls' };

    expect(withLegacyText(event, translate)).toEqual({ ...event, message: 'agy denegó el comando «ls»: lo prohíbe una regla deny.' });
  });

  it('withLegacyText_queuedMessageFailed_anadeError', () => {
    const event: MageEvent = { kind: 'queued_message_failed', message: QUEUED, localized: foreignText('proceso muerto') };

    expect(withLegacyText(event, translate)).toEqual({ ...event, error: 'proceso muerto' });
  });

  it('withLegacyText_otroEvento_igual', () => {
    const event: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };

    expect(withLegacyText(event, translate)).toBe(event);
  });
});
