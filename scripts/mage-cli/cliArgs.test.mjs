import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './cliArgs.mjs';

describe('parseCliArgs', () => {
  it('parseCliArgs_sinArgumentos_help', () => {
    expect(parseCliArgs([])).toEqual({ command: 'help' });
  });

  it.each(['help', '--help', '-h'])('parseCliArgs_help_%s', (word) => {
    expect(parseCliArgs([word])).toEqual({ command: 'help' });
  });

  it('parseCliArgs_chat_delegaEnChatArgs', () => {
    expect(parseCliArgs(['chat', '--session', 's1'])).toEqual({ command: 'chat', userDataDir: null, target: { kind: 'session', sessionId: 's1' } });
  });

  it('parseCliArgs_stop_porDefecto', () => {
    expect(parseCliArgs(['stop'])).toEqual({ command: 'stop', force: false, userDataDir: null });
  });

  it('parse_mcp_withUserDataDir', () => {
    expect(parseCliArgs(['mcp', '--user-data-dir', '/tmp/p'])).toEqual({ command: 'mcp', userDataDir: '/tmp/p' });
    expect(parseCliArgs(['mcp'])).toEqual({ command: 'mcp', userDataDir: null });
  });

  it('parse_mcp_unknownOption_error', () => {
    expect(() => parseCliArgs(['mcp', '--force'])).toThrow('Opción desconocida: --force');
  });

  it('parseCliArgs_stopForceYPerfil', () => {
    expect(parseCliArgs(['stop', '--force', '--user-data-dir', '/tmp/p'])).toEqual({ command: 'stop', force: true, userDataDir: '/tmp/p' });
  });

  it('parseCliArgs_accountAdd_completo', () => {
    const args = ['account', 'add', '--provider', 'codex', '--name', 'K', '--user-data-dir', '/tmp/p'];
    expect(parseCliArgs(args)).toEqual({ command: 'accountAdd', provider: 'codex', name: 'K', userDataDir: '/tmp/p' });
  });

  it('parseCliArgs_accountAdd_sinName_lanza', () => {
    expect(() => parseCliArgs(['account', 'add', '--provider', 'claude'])).toThrow('account add necesita --name');
  });

  it('parseCliArgs_accountAdd_proveedorAgy_lanza', () => {
    expect(() => parseCliArgs(['account', 'add', '--provider', 'agy', '--name', 'K'])).toThrow('--provider debe ser claude o codex, se recibió: agy');
  });

  it('parseCliArgs_accountAdd_apiKeyEnLaLinea_opcionDesconocida', () => {
    let message = '';
    try {
      parseCliArgs(['account', 'add', '--provider', 'claude', '--name', 'K', '--api-key', 'sk-x']);
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('Opción desconocida: --api-key');
    expect(message).not.toContain('sk-x');
  });

  it('parseCliArgs_accountOtroSubcomando_lanza', () => {
    expect(() => parseCliArgs(['account', 'rm'])).toThrow('se recibió «rm»');
  });

  it('parseCliArgs_comandoDesconocido_lanza', () => {
    expect(() => parseCliArgs(['rm'])).toThrow('Comando desconocido: rm');
  });
});
