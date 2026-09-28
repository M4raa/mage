import { describe, expect, it } from 'vitest';
import { agentsDockRows } from './agentsDock';
import type { Block } from './types';

type ToolBlock = Extract<Block, { kind: 'tool' }>;

const user = (id: string): Block => ({ kind: 'user', id, text: 'hola', time: '', attachments: [] });
const subagent = (id: string, status: string | null = null, elapsedMs: number | null = null): Block => ({
  kind: 'subagent',
  id,
  toolUseId: `u-${id}`,
  agentType: 'Explore',
  description: `buscar ${id}`,
  agentId: null,
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
    const rows = agentsDockRows([user('u1'), subagent('viejo', 'completado'), user('u2'), subagent('nuevo')]);

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
    const rows = agentsDockRows([user('u'), subagent('a', 'completado', 9000), subagent('b', 'error', 0)]);

    expect(rows.map((r) => [r.state, r.currentStep, r.elapsedMs])).toEqual([
      ['done', 'Terminado', 9000],
      ['error', 'Falló', 0],
    ]);
  });

  it('agentsDockRows_sinTipo_nombreGenerico', () => {
    const block = { ...subagent('s'), agentType: null } as Block;

    expect(agentsDockRows([block])[0]?.name).toBe('Subagente');
  });
});
