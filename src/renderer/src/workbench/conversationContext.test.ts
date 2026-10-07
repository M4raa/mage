import { describe, expect, it } from 'vitest';
import { importedConversationContext } from './conversationContext';
import type { Block } from './types';

const SOURCE = { title: 'Arreglar el login', fromProvider: 'Codex' };
const user = (text: string): Block => ({ kind: 'user', id: 'u', text, time: '', attachments: [] });
const agent = (text: string): Block => ({ kind: 'agent', id: 'a', runs: [{ code: false, text }], streaming: false });
const tool = (command: string, isError = false, output = ''): Block => ({ kind: 'tool', id: 't', toolUseId: 'x', tool: 'Bash', command, isError, output: output === '' ? [] : [{ code: true, text: output }] } as unknown as Block);

describe('importedConversationContext', () => {
  it('importedConversationContext_hiloNormal_usuarioAsistenteYHerramientasEnOrden', () => {
    const text = importedConversationContext([user('hola'), tool('ls -la'), agent('hecho')], SOURCE)!;

    expect(text).toContain('«Arreglar el login»');
    expect(text).toContain('Codex');
    expect(text.indexOf('Usuario: hola')).toBeLessThan(text.indexOf('[herramienta Bash: ls -la]'));
    expect(text.indexOf('[herramienta Bash: ls -la]')).toBeLessThan(text.indexOf('Asistente: hecho'));
  });

  it('importedConversationContext_herramientaConError_loDice', () => {
    expect(importedConversationContext([tool('pnpm test', true)], SOURCE)).toContain('(con error)');
  });

  it('importedConversationContext_herramientaConSalida_incluyeUnExtractoUnaLinea', () => {
    const text = importedConversationContext([tool('ls', false, 'a.txt\n  b.txt')], SOURCE)!;

    expect(text).toContain('[herramienta Bash: ls → a.txt b.txt]');
  });

  it('importedConversationContext_salidaLarga_secortaConPuntosSuspensivos', () => {
    const text = importedConversationContext([tool('cat x', false, 'z'.repeat(1000))], SOURCE)!;

    expect(text).toContain(`${'z'.repeat(300)}…]`);
    expect(text).not.toContain('z'.repeat(301));
  });

  it('importedConversationContext_sinNadaQueContar_null', () => {
    expect(importedConversationContext([], SOURCE)).toBeNull();
    expect(importedConversationContext([user('   '), agent('')], SOURCE)).toBeNull();
  });

  it('importedConversationContext_masLargoQueElTope_conservaLoMasRecienteYAvisa', () => {
    const blocks = [user('a'.repeat(60)), agent('b'.repeat(60)), user('lo ultimo')];

    const text = importedConversationContext(blocks, SOURCE, 100)!;

    expect(text).toContain('lo ultimo');
    expect(text).not.toContain('a'.repeat(60));
    expect(text).toContain('Se omiten los 1 mensajes más antiguos');
  });

  it('importedConversationContext_unSoloMensajeEnormeYConTope_loRecortaPeroNoQuedaVacio', () => {
    const text = importedConversationContext([user('x'.repeat(500))], SOURCE, 50)!;

    expect(text.endsWith('x'.repeat(50))).toBe(true);
    expect(text.length).toBeLessThan(400);
  });
});
