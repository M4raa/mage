import { describe, expect, it } from 'vitest';
import { completeDelegation, parseDelegationDraft } from './delegationCards';

describe('parseDelegationDraft', () => {
  it('parseDelegationDraft_conTitle_usaElTitle', () => {
    expect(parseDelegationDraft('mcp__mage__mage_create_session', { title: ' Hola 1 ', prompt: 'otra cosa' })).toEqual({ title: 'Hola 1' });
  });

  it('parseDelegationDraft_sinTitle_primeraLineaDelPromptRecortada', () => {
    const prompt = `${'x'.repeat(100)}\nsegunda`;

    expect(parseDelegationDraft('mcp__mage__mage_create_session', { prompt })?.title).toBe('x'.repeat(80));
  });

  it('parseDelegationDraft_otraHerramienta_null', () => {
    expect(parseDelegationDraft('mcp__mage__mage_send', { title: 'a' })).toBeNull();
    expect(parseDelegationDraft('Bash', {})).toBeNull();
  });

  it('parseDelegationDraft_sinNada_tituloVacio', () => {
    expect(parseDelegationDraft('mcp__mage__mage_create_session', {})).toEqual({ title: '' });
  });
});

describe('completeDelegation', () => {
  const draft = { title: 'Hola 1' };

  it('completeDelegation_resultadoJson_traeElConversationId', () => {
    expect(completeDelegation(draft, '{"conversationId":"c-1","state":"running"}')).toEqual({ title: 'Hola 1', conversationId: 'c-1' });
  });

  it('completeDelegation_resultadoNoJson_null', () => {
    expect(completeDelegation(draft, 'launch_failed: sesion cerrada')).toBeNull();
  });

  it('completeDelegation_sinConversationId_null', () => {
    expect(completeDelegation(draft, '{"state":"running"}')).toBeNull();
    expect(completeDelegation(draft, '{"conversationId":""}')).toBeNull();
    expect(completeDelegation(draft, 'null')).toBeNull();
  });
});
