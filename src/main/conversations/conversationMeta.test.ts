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

    expect(meta).toEqual({ cwd: '', title: '', hasUserMessage: false, isScheduled: false });
  });

  it('deriveConversationMeta_variosCustomTitle_usaElUltimo', () => {
    const meta = deriveConversationMeta([
      userLine('prompt'),
      JSON.stringify({ type: 'custom-title', customTitle: 'Viejo' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'Nuevo' }),
    ]);

    expect(meta.title).toBe('Nuevo');
  });

  it('deriveConversationMeta_customTitleSoloEnLaCola_loUsa', () => {
    const meta = deriveConversationMeta([userLine('prompt')], ['{"trozo":"parti', JSON.stringify({ type: 'custom-title', customTitle: 'De la cola' })]);

    expect(meta.title).toBe('De la cola');
  });

  it('deriveConversationMeta_variosAiTitle_usaElUltimo', () => {
    const meta = deriveConversationMeta([userLine('p'), JSON.stringify({ type: 'ai-title', aiTitle: 'A' })], [JSON.stringify({ type: 'ai-title', aiTitle: 'B' })]);

    expect(meta.title).toBe('B');
  });

  it('deriveConversationMeta_primerUserEsCaveatOComando_loSalta', () => {
    const meta = deriveConversationMeta([
      userLine('<local-command-caveat>Caveat: no respondas</local-command-caveat>'),
      userLine('<local-command-stdout>Login successful</local-command-stdout>'),
      userLine('<system-reminder>contexto</system-reminder>'),
      userLine('Arregla el login'),
    ]);

    expect(meta.title).toBe('Arregla el login');
    expect(meta.hasUserMessage).toBe(true);
  });

  it('deriveConversationMeta_isMeta_loSalta', () => {
    const meta = deriveConversationMeta([
      JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'aviso del CLI' } }),
      userLine('lo de verdad'),
    ]);

    expect(meta.title).toBe('lo de verdad');
  });

  it('deriveConversationMeta_commandName_devuelveComandoYArgs', () => {
    const meta = deriveConversationMeta([
      userLine('<command-name>/rename</command-name>\n  <command-message>rename</command-message>\n  <command-args>REVISION</command-args>'),
    ]);

    expect(meta.title).toBe('/rename REVISION');
    expect(meta.hasUserMessage).toBe(true);
  });

  it('deriveConversationMeta_scheduledTask_usaNombreYMarcaProgramada', () => {
    const meta = deriveConversationMeta([userLine('<scheduled-task name="say-hello" file="C:\\x\\SKILL.md">\nSay .\n</scheduled-task>')]);

    expect(meta).toMatchObject({ title: 'say-hello', isScheduled: true, hasUserMessage: true });
  });

  it('deriveConversationMeta_sinMensajeDeUsuario_seExcluye', () => {
    // Solo metadatos y avisos: una conversacion que el usuario nunca escribio (D4).
    const meta = deriveConversationMeta([
      JSON.stringify({ type: 'custom-title', customTitle: 'x' }),
      userLine('<local-command-caveat>Caveat</local-command-caveat>'),
    ]);

    expect(meta.hasUserMessage).toBe(false);
  });

  it('deriveConversationMeta_soloImagen_esMensajeRealSinTitulo', () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: {} }] } });

    expect(deriveConversationMeta([line])).toMatchObject({ title: '', hasUserMessage: true });
  });

  it('deriveConversationMeta_pegado_quitaLasEtiquetasDelTitulo', () => {
    const meta = deriveConversationMeta([userLine('\n\n<pasted_content id="d1">\nAdopción de core\n</pasted_content>')]);

    expect(meta.title).toBe('Adopción de core');
  });
});
