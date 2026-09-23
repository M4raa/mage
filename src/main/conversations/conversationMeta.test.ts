import { describe, expect, it } from 'vitest';
import { deriveConversationMeta } from './conversationMeta';

const userLine = (text: string): string =>
  JSON.stringify({ type: 'user', cwd: 'C:\\proj', message: { role: 'user', content: text } });

describe('deriveConversationMeta', () => {
  it('primerMensajeUsuario_esElTituloYExtraeCwd', () => {
    const meta = deriveConversationMeta([userLine('Arregla el login'), '{"type":"assistant"}']);

    expect(meta.title).toBe('Arregla el login');
    expect(meta.cwd).toBe('C:\\proj');
  });

  it('customTitle_ganaSobreAiTitleYPrimerPrompt', () => {
    const meta = deriveConversationMeta([
      userLine('prompt inicial'),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Título IA' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Mi título' }),
    ]);

    expect(meta.title).toBe('Mi título');
  });

  it('aiTitle_ganaSobreElPrimerPrompt', () => {
    const meta = deriveConversationMeta([userLine('prompt'), JSON.stringify({ type: 'ai-title', aiTitle: 'Resumen IA' })]);

    expect(meta.title).toBe('Resumen IA');
  });

  it('contentEnBloques_concatenaSoloElTexto', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hola' }, { type: 'tool_result' }, { type: 'text', text: 'mundo' }] },
    });

    expect(deriveConversationMeta([line]).title).toBe('hola mundo');
  });

  it('lineasIlegiblesOVacias_seIgnoran', () => {
    const meta = deriveConversationMeta(['', '{json roto', userLine('válido')]);

    expect(meta.title).toBe('válido');
  });

  it('tituloMuyLargo_seRecorta', () => {
    const meta = deriveConversationMeta([userLine('x'.repeat(120))]);

    expect(meta.title.length).toBe(80);
    expect(meta.title.endsWith('…')).toBe(true);
  });

  it('sinLineasUtiles_devuelveVacios', () => {
    const meta = deriveConversationMeta(['', '   ']);

    expect(meta).toEqual({ cwd: '', title: '' });
  });
});
