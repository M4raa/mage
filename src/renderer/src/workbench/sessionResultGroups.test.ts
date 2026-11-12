import { describe, expect, it } from 'vitest';
import { sessionResultMessage } from '@shared/systemWrappers';
import { chatRows, type ChatRow } from './chatVisibility';
import { groupSessionResults } from './sessionResultGroups';
import type { Block } from './types';

const user = (id: string, text: string): Block => ({ kind: 'user', id, text, time: '', attachments: [], nativeId: null });
const result = (id: string, conversationId: string): Block => user(id, sessionResultMessage({ title: `Hola ${id}`, conversationId, text: 'hola' }));
const agent = (id: string): Block => ({ kind: 'agent', id, runs: [{ code: false, text: 'ok' }], streaming: false });
const asRows = (blocks: readonly Block[]): ChatRow[] => blocks.map((block) => ({ kind: 'block', block }));
const kinds = (rows: readonly ChatRow[]): readonly string[] => rows.map((row) => row.kind);

describe('groupSessionResults', () => {
  it('groupSessionResults_uno_unGrupoDeUno', () => {
    const rows = groupSessionResults(asRows([result('r1', 'c1')]));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'session-results', blocks: [{ id: 'r1' }] });
  });

  it('groupSessionResults_dosSeguidos_unGrupoConLasDos', () => {
    const rows = groupSessionResults(asRows([result('r1', 'c1'), result('r2', 'c2')]));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'session-results', id: 'session-results-r1' });
    expect((rows[0] as Extract<ChatRow, { kind: 'session-results' }>).blocks.map((block) => block.id)).toEqual(['r1', 'r2']);
  });

  it('groupSessionResults_separadosPorUnaRespuestaDelAgente_dosGrupos', () => {
    const rows = groupSessionResults(asRows([result('r1', 'c1'), agent('a1'), result('r2', 'c2')]));

    expect(kinds(rows)).toEqual(['session-results', 'block', 'session-results']);
  });

  it('groupSessionResults_ninguno_igual', () => {
    const rows = asRows([user('u1', 'hola'), agent('a1')]);

    expect(groupSessionResults(rows)).toEqual(rows);
  });

  it('chatRows_respuestasConHerramientasInvisiblesEntreMedias_seguiaSiendoUnGrupo', () => {
    const hidden = { kind: 'thinking', id: 'th', runs: [], elapsedMs: null } as unknown as Block;

    const rows = chatRows([result('r1', 'c1'), hidden, result('r2', 'c2')]);

    expect(kinds(rows)).toEqual(['session-results']);
  });
});
