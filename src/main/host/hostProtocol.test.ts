import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import { foreignText, localized } from '@shared/i18n/localizedText';
import { createTranslator } from '@shared/i18n/translator';
import { HOST_CAPABILITIES, HOST_METHOD_SCHEMAS, HOST_PROTOCOL, withLegacyText } from './hostProtocol';

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

describe('HOST_PROTOCOL', () => {
  it('hostProtocol_version_is14', () => {
    expect(HOST_PROTOCOL).toBe('1.4');
  });
});

describe('host 1.2 — capacidades y esquemas', () => {
  const CREATE = { commandId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b', provider: 'claude', accountId: 'C:\\Users\\u\\.claude', cwd: 'C:\\tmp\\x', trust: { acknowledged: false } };

  it('capabilities_includeRewindMethods', () => {
    expect(HOST_CAPABILITIES).toEqual(expect.arrayContaining(['session.rewindPoints', 'session.rewindPlan', 'session.rewind']));
  });

  it('rewindApplySchema_attachments_rejected', () => {
    const params = { sessionId: 's1', point: { userIndex: 0, text: 'a', nativeId: 'u1' }, action: 'rewind', restoreFiles: false, saveCopy: false };

    expect(HOST_METHOD_SCHEMAS['session.rewind'].safeParse(params).success).toBe(true);
    expect(HOST_METHOD_SCHEMAS['session.rewind'].safeParse({ ...params, attachments: [] }).success).toBe(false);
  });

  it('rewindPlanSchema_divergeAction_rejected', () => {
    const params = { sessionId: 's1', point: { userIndex: 0, text: 'a', nativeId: null }, action: 'diverge' };

    expect(HOST_METHOD_SCHEMAS['session.rewindPlan'].safeParse(params).success).toBe(false);
  });

  it('capabilities_anuncianLosMetodosDe13', () => {
    expect(HOST_CAPABILITIES).toEqual(expect.arrayContaining(['host.stop', 'accounts.create', 'session.updateQueued']));
  });

  it('capabilities_anuncianLosMetodosDe12', () => {
    expect(HOST_CAPABILITIES).toEqual(expect.arrayContaining(['session.create', 'session.resume', 'session.setOption', 'session.cancelQueued', 'projects.list', 'accounts.list', 'host.info']));
  });

  it('sessionCreate_minimoValido_pasa', () => {
    expect(HOST_METHOD_SCHEMAS['session.create'].safeParse(CREATE).success).toBe(true);
  });

  it.each([
    ['commandIdNoUuid', { commandId: 'no-uuid' }],
    ['proveedorAgy', { provider: 'agy' }],
    ['sinTrust', { trust: undefined }],
    ['permissionModeRaro', { permissionMode: 'yolo' }],
    ['campoExtra', { privacy: 'private' }],
    ['cwdVacio', { cwd: '' }],
  ])('sessionCreate_invalidos_fallan_%s', (_name, override) => {
    expect(HOST_METHOD_SCHEMAS['session.create'].safeParse({ ...CREATE, ...override }).success).toBe(false);
  });

  it('setOption_valorVacio_soloEnEffort', () => {
    const schema = HOST_METHOD_SCHEMAS['session.setOption'];

    expect(schema.safeParse({ sessionId: 's1', key: 'effort', value: '' }).success).toBe(true);
    expect(schema.safeParse({ sessionId: 's1', key: 'model', value: '' }).success).toBe(false);
    expect(schema.safeParse({ sessionId: 's1', key: 'permissionMode', value: '' }).success).toBe(false);
  });

  it('updateQueued_textoVacio_falla', () => {
    expect(HOST_METHOD_SCHEMAS['session.updateQueued'].safeParse({ sessionId: 's1', queuedId: 'q1', text: '' }).success).toBe(false);
  });
});
