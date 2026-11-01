import { describe, expect, it } from 'vitest';
import { defaultUserDataDir, parseChatArgs } from './chatArgs.mjs';

describe('parseChatArgs', () => {
  it('parseChatArgs_sinObjetivo_pick', () => {
    expect(parseChatArgs(['chat'])).toEqual({ userDataDir: null, target: { kind: 'pick' } });
  });

  it('parseChatArgs_session', () => {
    const result = parseChatArgs(['chat', '--user-data-dir', 'D:\\p', '--session', 's1']);

    expect(result).toEqual({ userDataDir: 'D:\\p', target: { kind: 'session', sessionId: 's1' } });
  });

  it('parseChatArgs_conversation', () => {
    expect(parseChatArgs(['chat', '--conversation', 'c1']).target).toEqual({ kind: 'conversation', conversationId: 'c1' });
  });

  it('parseChatArgs_newCompleto', () => {
    const argv = ['chat', '--new', '--account', 'a1', '--provider', 'codex', '--cwd', '/w', '--model', 'm', '--effort', 'low', '--permission-mode', 'plan'];

    expect(parseChatArgs(argv).target).toEqual({
      kind: 'new', accountId: 'a1', provider: 'codex', cwd: '/w', model: 'm', effort: 'low', permissionMode: 'plan',
    });
  });

  it('parseChatArgs_newMinimo_cwdNull', () => {
    expect(parseChatArgs(['chat', '--new', '--account', 'a1', '--provider', 'claude']).target)
      .toEqual({ kind: 'new', accountId: 'a1', provider: 'claude', cwd: null });
  });

  it.each([
    ['sinChat', ['hola'], 'hola'],
    ['opcionDesconocida', ['chat', '--zzz'], '--zzz'],
    ['opcionSinValor', ['chat', '--session'], '--session'],
    ['dosObjetivos', ['chat', '--session', 's', '--conversation', 'c'], '2'],
    ['newSinAccount', ['chat', '--new', '--provider', 'claude'], '--account'],
    ['newSinProvider', ['chat', '--new', '--account', 'a'], '--provider'],
    ['providerInvalido', ['chat', '--new', '--account', 'a', '--provider', 'agy'], 'agy'],
    ['accountSinNew', ['chat', '--account', 'zz'], 'zz'],
    ['cwdSinNew', ['chat', '--cwd', '/zz'], '/zz'],
    ['modelSinNew', ['chat', '--model', 'mm'], 'mm'],
    ['effortSinNew', ['chat', '--effort', 'ee'], 'ee'],
    ['permissionModeSinNew', ['chat', '--permission-mode', 'pp'], 'pp'],
  ])('parseChatArgs_errores (%s)', (_name, argv, received) => {
    expect(() => parseChatArgs(argv)).toThrow(received);
  });
});

describe('defaultUserDataDir', () => {
  it.each([
    [{ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, homedir: 'C:\\Users\\u' }, 'C:\\Users\\u\\AppData\\Roaming\\Mage'],
    [{ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' }, homedir: '/home/u' }, '/x/Mage'],
    [{ platform: 'linux', env: {}, homedir: '/home/u' }, '/home/u/.config/Mage'],
    [{ platform: 'darwin', env: {}, homedir: '/Users/u' }, '/Users/u/Library/Application Support/Mage'],
  ])('defaultUserDataDir_casos (%j)', (input, expected) => {
    expect(defaultUserDataDir(input)).toBe(expected);
  });

  it('defaultUserDataDir_win32SinAppdata_lanza', () => {
    expect(() => defaultUserDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\u' })).toThrow('APPDATA');
  });
});
