import { describe, expect, it } from 'vitest';
import { activityStepLabel, activityTurns, chatRows, currentTurnSummary, isChatBlock, runningStepId, stickResetKey } from './chatVisibility';
import type { Block } from './types';

type ToolBlock = Extract<Block, { kind: 'tool' }>;

const user = (id: string, text = 'hola'): Block => ({ kind: 'user', id, text, time: '', attachments: [] });
const agent = (id: string): Block => ({ kind: 'agent', id, runs: [{ code: false, text: 'Voy a revisar X' }], streaming: false });
const thinking = (id: string): Block => ({ kind: 'thinking', id, runs: [], streaming: false, elapsedMs: null });
const tool = (id: string, over: Partial<ToolBlock> = {}): Block => ({
  kind: 'tool',
  id,
  toolUseId: `u-${id}`,
  tool: 'Bash',
  toolClass: 'command',
  command: 'ls',
  meta: 'ok',
  isError: false,
  output: [],
  filePath: null,
  diff: null,
  writtenContent: null,
  artifact: null,
  artifactDraft: null,
  parentToolUseId: null,
  ...over,
});
const permission = (id: string, state: 'pending' | 'allowed'): Block => ({
  kind: 'permission',
  id,
  requestId: `r-${id}`,
  toolName: 'Write',
  prompt: 'quiere escribir',
  target: 'a.txt',
  summary: '',
  state,
});
const subagent = (id: string, status: string | null = null): Block => ({
  kind: 'subagent',
  id,
  toolUseId: `u-${id}`,
  agentType: 'general-purpose',
  description: 'buscar',
  agentId: null,
  tokens: null,
  toolUses: null,
  model: null,
  status,
  elapsedMs: null,
});
const PUBLISHED_ARTIFACT = { url: 'https://claude.ai/artifact/x', title: 'Informe', favicon: 'doc' } as const;

describe('isChatBlock', () => {
  it('isChatBlock_tool_false', () => {
    expect(isChatBlock(tool('t'))).toBe(false);
  });

  it('isChatBlock_artifactPublicado_true', () => {
    expect(isChatBlock(tool('t', { artifact: PUBLISHED_ARTIFACT as unknown as ToolBlock['artifact'] }))).toBe(true);
  });

  it('isChatBlock_permisoPendiente_true', () => {
    expect(isChatBlock(permission('p', 'pending'))).toBe(true);
  });

  it('isChatBlock_permisoResuelto_false', () => {
    expect(isChatBlock(permission('p', 'allowed'))).toBe(false);
  });

  it('isChatBlock_thinking_false', () => {
    expect(isChatBlock(thinking('k'))).toBe(false);
  });

  it('isChatBlock_agentIntermedio_true', () => {
    // D21b: el texto del agente se queda en el chat aunque sea «Voy a revisar X».
    expect(isChatBlock(agent('a'))).toBe(true);
  });
});

describe('chatRows', () => {
  it('chatRows_herramientaFallidaDelPrincipal_dejaSuLinea', () => {
    const rows = chatRows([user('u'), tool('t', { isError: true }), tool('ok')]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'tool-failed']);
  });

  it('chatRows_fallidaDeUnSubagente_noSaleEnElChat', () => {
    expect(chatRows([tool('t', { isError: true, parentToolUseId: 'u-s' })])).toEqual([]);
  });

  it('chatRows_variosSubagentesEnUnTurno_unaSolaLinea', () => {
    const rows = chatRows([user('u'), agent('a'), subagent('s1'), subagent('s2'), user('v'), subagent('s3')]);

    expect(rows.map((r) => (r.kind === 'subagents' ? `sub:${r.blocks.length}` : r.kind))).toEqual(['block', 'block', 'sub:2', 'block', 'sub:1']);
  });
});

describe('activityTurns', () => {
  it('activityTurns_vacio_vacio', () => {
    expect(activityTurns([])).toEqual([]);
  });

  it('activityTurns_dosUsuarios_cortaEnOrden', () => {
    const turns = activityTurns([user('u1', 'primero'), tool('a'), thinking('k'), user('u2', 'segundo'), tool('b')]);

    expect(turns.map((t) => [t.turnIndex, t.userPreview, t.steps.map((s) => s.id)])).toEqual([
      [1, 'primero', ['a', 'k']],
      [2, 'segundo', ['b']],
    ]);
  });

  it('activityTurns_pasosAntesDelPrimerUsuario_turno0', () => {
    expect(activityTurns([tool('a'), user('u'), tool('b')])[0]).toMatchObject({ turnIndex: 0, steps: [expect.objectContaining({ id: 'a' })] });
  });

  it('activityTurns_permisoPendienteNoEsPaso_elResueltoSi', () => {
    const turns = activityTurns([user('u'), permission('p1', 'pending'), permission('p2', 'allowed')]);

    expect(turns[0]?.steps.map((s) => s.id)).toEqual(['p2']);
  });

  it('activityTurns_pasoConError_marcado', () => {
    const blocks = [user('u'), tool('a', { isError: true }), tool('b'), subagent('s', 'error')];

    expect(currentTurnSummary(blocks)).toEqual({ steps: 3, errors: 2 });
  });

  it('currentTurnSummary_soloCuentaDesdeElUltimoUsuario', () => {
    expect(currentTurnSummary([user('u1'), tool('a', { isError: true }), user('u2'), tool('b')])).toEqual({ steps: 1, errors: 0 });
  });
});

describe('activityStepLabel', () => {
  it('activityStepLabel_herramientaEnCurso_metaPuntos', () => {
    expect(activityStepLabel(tool('t', { meta: '' }))).toMatchObject({ name: 'Bash', meta: '…', nested: false, isError: false });
  });

  it('activityStepLabel_herramientaDeSubagente_sangrada', () => {
    expect(activityStepLabel(tool('t', { parentToolUseId: 'u-s' })).nested).toBe(true);
  });

  it('activityStepLabel_permisoDenegado_loDice', () => {
    expect(activityStepLabel({ ...permission('p', 'allowed'), state: 'denied' } as Block).meta).toBe('denegado');
  });

  it('activityStepLabel_thinkingSinTexto_detalleVacio', () => {
    expect(activityStepLabel(thinking('k'))).toMatchObject({ name: 'Pensamiento', detail: '', meta: '' });
  });
});

describe('stickResetKey', () => {
  it('mensajeNuevoDelUsuario_cambiaLaClave', () => {
    const before = stickResetKey('t1', [user('u1'), agent('a1')]);

    expect(stickResetKey('t1', [user('u1'), agent('a1'), user('u2')])).not.toBe(before);
  });

  it('respuestaDelAgente_noCambiaLaClave', () => {
    expect(stickResetKey('t1', [user('u1')])).toBe(stickResetKey('t1', [user('u1'), agent('a1')]));
  });

  it('chatVacioVsHidratado_cambiaLaClave', () => {
    expect(stickResetKey('t1', [])).not.toBe(stickResetKey('t1', [agent('a1')]));
  });

  it('otraPestana_cambiaLaClave', () => {
    expect(stickResetKey('t1', [user('u1')])).not.toBe(stickResetKey('t2', [user('u1')]));
  });
});

describe('runningStepId', () => {
  const turnOf = (...steps: Block[]) => ({ turnIndex: 1, userPreview: '', steps });

  it('runningStepId_herramientaSinResultadoConTurnoVivo_esEsa', () => {
    expect(runningStepId(turnOf(tool('a'), tool('b', { meta: '' })), true)).toBe('b');
  });

  it('runningStepId_turnoNoVivo_esNull', () => {
    // Un turno interrumpido deja tools con meta vacio: no hay nada corriendo.
    expect(runningStepId(turnOf(tool('a', { meta: '' })), false)).toBeNull();
  });

  it('runningStepId_pensamientoSinDuracion_estaEnMarcha', () => {
    expect(runningStepId(turnOf(thinking('k')), true)).toBe('k');
  });

  it('runningStepId_subagentePendienteOAsincrono_estaEnMarcha', () => {
    expect(runningStepId(turnOf(subagent('s1', null)), true)).toBe('s1');
    expect(runningStepId(turnOf(subagent('s2', 'en segundo plano')), true)).toBe('s2');
  });

  it('runningStepId_subagenteTerminado_noCuenta', () => {
    expect(runningStepId(turnOf(subagent('s', 'completado')), true)).toBeNull();
  });

  it('runningStepId_variosEnMarcha_devuelveElUltimo', () => {
    expect(runningStepId(turnOf(tool('a', { meta: '' }), tool('b', { meta: '' })), true)).toBe('b');
  });

  it('runningStepId_turnoSinPasos_esNull', () => {
    expect(runningStepId(turnOf(), true)).toBeNull();
  });
});
