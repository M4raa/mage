import { describe, expect, it } from 'vitest';
import { createMessages, pickLanguage } from './messages.mjs';

describe('messages', () => {
  it.each([
    [{ env: { LANG: 'es_ES.UTF-8' }, intlLocale: 'en-GB' }, 'es'],
    [{ env: { LC_ALL: 'en_US', LANG: 'es_ES' }, intlLocale: 'es-ES' }, 'en'],
    [{ env: {}, intlLocale: 'es-ES' }, 'es'],
    [{ env: {}, intlLocale: 'en-GB' }, 'en'],
  ])('pickLanguage_casos (%j)', (input, expected) => {
    expect(pickLanguage(input)).toBe(expected);
  });

  it('createMessages_mismasClavesEnLosDosIdiomas', () => {
    const es = Object.keys(createMessages('es')).sort();
    const en = Object.keys(createMessages('en')).sort();

    expect(en).toEqual(es);
    expect(es).toHaveLength(75);
  });

  it('createMessages_permissionAsk_sinDescripcion_noPoneParentesis', () => {
    const messages = createMessages('es');

    expect(messages.permissionAsk('Bash', null)).toBe('¿Permitir Bash? [s/n]');
    expect(messages.permissionAsk('Bash', 'ls')).toBe('¿Permitir Bash? (ls) [s/n]');
  });

  it.each([
    ['boolean', { type: 'boolean' }, '[s/n]'],
    ['integerConRango', { type: 'integer', minimum: 1, maximum: 10 }, '(número entre 1 y 10)'],
    ['enum', { type: 'string', enum: ['a', 'b'] }, '(1) a, 2) b)'],
    ['password', { type: 'string', format: 'password' }, '(no se verá al escribir)'],
    ['stringLibre', { type: 'string' }, ''],
  ])('fieldHint_%s', (_name, field, expected) => {
    expect(createMessages('es').fieldHint(field)).toBe(expected);
  });

  it('elicitationInvalid_motivoDesconocido_lanza', () => {
    expect(() => createMessages('es').elicitationInvalid('raro')).toThrow('Motivo de dato no válido desconocido: raro');
  });

  it('createMessages_idiomaDesconocido_lanza', () => {
    expect(() => createMessages('fr')).toThrow('fr');
  });

  it.each(['es', 'en'])('stopActive_unaLineaPorSesion (%s)', (language) => {
    const sessions = [
      { sessionId: 's1', conversationId: 'c1', provider: 'claude', state: 'running' },
      { sessionId: 's2', conversationId: null, provider: 'codex', state: 'idle' },
    ];

    const lines = createMessages(language).stopActive(sessions).split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('  claude · running · c1');
    expect(lines[2]).toBe('  codex · idle · s2');
  });

  it.each(['es', 'en'])('help_nombraLosTresComandos (%s)', (language) => {
    const help = createMessages(language).help();

    expect(help).toContain('mage chat');
    expect(help).toContain('mage stop');
    expect(help).toContain('mage account add');
    expect(help.endsWith('\n')).toBe(false);
  });
});

describe('messages: rewind', () => {
  const KEYS = ['rewindUsage', 'rewindUnknownOption', 'rewindNoPoints', 'rewindPointLine', 'rewindAskNumber', 'rewindInvalidNumber', 'rewindNotRewindable',
    'rewindCancelled', 'rewindUnavailable', 'rewindPlanSummary', 'rewindFilesUnavailable', 'rewindCopyUnavailable', 'rewindConfirm', 'rewindDone', 'rewindReturnedQueue'];

  it('messages_rewindKeys_presentInBothLanguages', () => {
    for (const language of ['es', 'en']) {
      const messages = createMessages(language);
      for (const key of KEYS) expect(typeof messages[key]).toBe('function');
    }
    expect(createMessages('en').rewindNoPoints()).not.toBe(createMessages('es').rewindNoPoints());
    expect(createMessages('en').rewindPointLine(1, 'a', false)).toBe('  1) a (not rewindable)');
  });

  it('rewindUnavailable_unknownReason_throws', () => {
    expect(() => createMessages('es').rewindUnavailable('raro')).toThrow('raro');
  });

  it('rewindPlanSummary_runningAndQueue_addsLines', () => {
    const text = createMessages('es').rewindPlanSummary({ discardedMessages: 3, turnRunning: true, queuedCount: 2 });

    expect(text.split('\n')).toEqual(['Se descartarán 3 mensajes.', 'Se parará el turno en marcha.', 'Los 2 mensajes de la cola vuelven a ti.']);
  });
});
