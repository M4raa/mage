import { describe, expect, it } from 'vitest';
import { askCreatorInputSchema, closeInputSchema, createInputSchema, readInputSchema } from './schemas';

const REQUEST = 'r-1';
const BASE = { requestId: REQUEST, provider: 'claude', cwd: '/synthetic', prompt: 'p' };

function messagesOf(schema: { safeParse: (value: unknown) => { error?: { issues: { message: string }[] } } }, input: unknown): string[] {
  return schema.safeParse(input).error?.issues.map((issue) => issue.message) ?? [];
}

// Los clientes del MCP comparan estos textos: tienen que salir igual que con zod 3, también cuando falla un
// check (`.min`, `.max`, `.int`) y no solo el tipo.
describe('MCP input diagnostics', () => {
  it.each([
    ['requestIdEmpty', { ...BASE, requestId: '' }, 'requestId: valor recibido '],
    ['requestIdTooLong', { ...BASE, requestId: 'x'.repeat(129) }, `requestId: valor recibido ${'x'.repeat(129)}`],
    ['requestIdMissing', { provider: 'claude', cwd: '/c', prompt: 'p' }, 'requestId: valor recibido <undefined>'],
    ['cwdEmpty', { ...BASE, cwd: '' }, 'cwd: valor recibido '],
    ['titleBlank', { ...BASE, title: '   ' }, 'title: valor recibido '],
    ['titleTooLong', { ...BASE, title: 'x'.repeat(81) }, `title: valor recibido ${'x'.repeat(81)}`],
    ['accountIdObject', { ...BASE, accountId: { a: 1 } }, 'accountId: valor recibido <object>'],
    ['providerNull', { ...BASE, provider: null }, 'provider: valor recibido null'],
    ['promptNumber', { ...BASE, prompt: 5 }, 'Se requiere texto'],
  ])('createInput_%s_keepsOwnDiagnostic', (_name, input, expected) => {
    // Arrange: casos de arriba. Act
    const messages = messagesOf(createInputSchema, input);
    // Assert
    expect(messages).toEqual([expected]);
  });

  it.each([
    ['afterSeqNegative', { conversationId: 'c', afterSeq: -1 }, 'afterSeq: valor recibido -1'],
    ['afterSeqFraction', { conversationId: 'c', afterSeq: 1.5 }, 'afterSeq: valor recibido 1.5'],
    ['maxBytesZero', { conversationId: 'c', maxBytes: 0 }, 'maxBytes: valor recibido 0'],
    ['maxBytesTooBig', { conversationId: 'c', maxBytes: 99_999_999 }, 'maxBytes: valor recibido 99999999'],
  ])('readInput_%s_keepsOwnDiagnostic', (_name, input, expected) => {
    // Arrange: casos de arriba. Act
    const messages = messagesOf(readInputSchema, input);
    // Assert
    expect(messages).toEqual([expected]);
  });

  it('askCreatorInput_emptyText_saysTextRequired', () => {
    // Arrange
    const input = { requestId: REQUEST, text: '' };
    // Act
    const messages = messagesOf(askCreatorInputSchema, input);
    // Assert
    expect(messages).toEqual(['Se requiere texto']);
  });

  it('closeInput_emptyConversationId_keepsOwnDiagnostic', () => {
    // Arrange
    const input = { requestId: REQUEST, conversationId: '' };
    // Act
    const messages = messagesOf(closeInputSchema, input);
    // Assert
    expect(messages).toEqual(['conversationId: valor recibido ']);
  });
});
