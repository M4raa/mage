import { SUBAGENT_STATUS, type SubagentStatus } from './engineBlocks';
import { describe, expect, it } from 'vitest';
import { agentsDockRows, agentsDockSummaryText, conversationAgentRows, summarizeAgentsDock } from './agentsDock';
import type { Block } from './types';

type ToolBlock = Extract<Block, { kind: 'tool' }>;

const user = (id: string): Block => ({ kind: 'user', id, text: 'hola', time: '', attachments: [], nativeId: null });
const subagent = (id: string, status: SubagentStatus | null = null, elapsedMs: number | null = null): Block => ({
  kind: 'subagent',
  id,
  toolUseId: `u-${id}`,
  agentType: 'Explore',
  description: `buscar ${id}`,
  agentId: null,
  tokens: null,
  toolUses: null,
  model: null,
  status,
  elapsedMs,
});
const tool = (id: string, parent: string | null, meta: string): Block => ({
  kind: 'tool',
  id,
  toolUseId: `u-${id}`,
  tool: 'Grep',
  toolClass: 'search',
  command: 'foo',
  meta,
  isError: false,
  output: [],
  filePath: null,
  diff: null,
  writtenContent: null,
  artifact: null,
  artifactDraft: null,
  parentToolUseId: parent,
} satisfies ToolBlock);

describe('agentsDockRows', () => {
  it('agentsDockRows_sinSubagentes_vacio', () => {
    expect(agentsDockRows([user('u'), tool('t', null, '')])).toEqual([]);
  });

  it('agentsDockRows_soloElTurnoEnCurso', () => {
    const rows = agentsDockRows([user('u1'), subagent('viejo', SUBAGENT_STATUS.completed), user('u2'), subagent('nuevo')]);

    expect(rows.map((r) => r.toolUseId)).toEqual(['u-nuevo']);
  });

  it('agentsDockRows_herramientaSinResultado_ejecutando', () => {
    const rows = agentsDockRows([user('u'), subagent('s'), tool('t1', 'u-s', 'ok'), tool('t2', 'u-s', '')]);

    expect(rows[0]).toMatchObject({ state: 'running', currentStep: 'Ejecutando Grep…' });
  });

  it('agentsDockRows_ultimaHerramientaTerminada_pensando', () => {
    const rows = agentsDockRows([user('u'), subagent('s'), tool('t1', 'u-s', 'ok'), tool('t2', null, '')]);

    expect(rows[0]?.currentStep).toBe('Pensando…');
  });

  it('agentsDockRows_estados_terminadoYError', () => {
    const rows = agentsDockRows([user('u'), subagent('a', SUBAGENT_STATUS.completed, 9000), subagent('b', 'error', 0)]);

    expect(rows.map((r) => [r.state, r.currentStep, r.elapsedMs])).toEqual([
      ['done', 'Terminado', 9000],
      ['error', 'Falló', 0],
    ]);
  });

  it('agentsDockRows_sinTipo_nombreGenerico', () => {
    const block = { ...subagent('s'), agentType: null } as Block;

    expect(agentsDockRows([block])[0]?.name).toBe('Subagente');
  });

  it('agentsDockRows_asyncLaunched_running', () => {
    // P-028 37a: lanzado en segundo plano no es «terminado».
    const rows = agentsDockRows([user('u'), subagent('s', SUBAGENT_STATUS.background)]);

    expect(rows[0]).toMatchObject({ state: 'running', currentStep: 'Pensando…', elapsedMs: null });
  });

  it('agentsDockRows_enMarchaDeUnTurnoAnterior_sigueEnElDock', () => {
    const rows = agentsDockRows([user('u1'), subagent('bg', SUBAGENT_STATUS.background), subagent('fin', SUBAGENT_STATUS.completed), user('u2')]);

    expect(rows.map((r) => r.toolUseId)).toEqual(['u-bg']);
  });

  it('agentsDockRows_ocultado_noSale', () => {
    const rows = agentsDockRows([user('u'), subagent('a', SUBAGENT_STATUS.completed), subagent('b', SUBAGENT_STATUS.completed)], new Set(['u-a']));

    expect(rows.map((r) => r.toolUseId)).toEqual(['u-b']);
  });

  it('agentsDockRows_ocultadoPeroEnMarcha_sale', () => {
    // Uno reanudado vuelve aunque siguiera en la lista de ocultos.
    const rows = agentsDockRows([user('u'), subagent('a', SUBAGENT_STATUS.background)], new Set(['u-a']));

    expect(rows).toHaveLength(1);
  });

  it('agentsDockRows_detenido_stopped', () => {
    expect(agentsDockRows([user('u'), subagent('s', SUBAGENT_STATUS.stopped)])[0]).toMatchObject({ state: 'stopped', currentStep: 'Detenido' });
  });
});

describe('linea agregada y lista del panel (P-028 38)', () => {
  it('summarizeAgentsDock_nueveEnMarchaDosParados_cuentaCadaUno', () => {
    const blocks = [user('u'), ...Array.from({ length: 9 }, (_, i) => subagent(`r${i}`, SUBAGENT_STATUS.background)), subagent('a', SUBAGENT_STATUS.completed), subagent('b', SUBAGENT_STATUS.stopped)];

    const summary = summarizeAgentsDock(agentsDockRows(blocks));

    expect(summary).toEqual({ running: 9, finished: 2 });
    expect(agentsDockSummaryText(summary)).toBe('9 en ejecución · 2 terminados');
  });

  it.each([
    [{ running: 1, finished: 0 }, '1 en ejecución'],
    [{ running: 0, finished: 1 }, '1 terminado'],
    [{ running: 0, finished: 0 }, ''],
  ])('agentsDockSummaryText_%j_omiteLoQueVaCero', (summary, expected) => {
    expect(agentsDockSummaryText(summary)).toBe(expected);
  });

  it('conversationAgentRows_todosLosTurnosYSusDatos', () => {
    const done = { ...subagent('a', SUBAGENT_STATUS.completed, 8000), agentId: 'ag1', tokens: 1200, toolUses: 3, model: 'haiku' } as Block;

    const rows = conversationAgentRows([user('u1'), done, user('u2'), subagent('b', SUBAGENT_STATUS.background)]);

    expect(rows.map((r) => [r.toolUseId, r.state])).toEqual([
      ['u-a', 'done'],
      ['u-b', 'running'],
    ]);
    expect(rows[0]).toMatchObject({ agentId: 'ag1', tokens: 1200, toolUses: 3, model: 'haiku', elapsedMs: 8000 });
  });
});
