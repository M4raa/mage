import { describe, expect, it } from 'vitest';
import type { PermissionRequest, ToolResult, ToolUse, TurnUsage } from '@shared/events';
import {
  appendDelta,
  appendSubagentBlock,
  appendThinkingDelta,
  applySubagentResult,
  applySubagentUpdate,
  isSubagentRunning,
  closeThinking,
  appendErrorBlock,
  appendSystemBlock,
  appendPermissionBlock,
  appendToolUse,
  appendUserBlock,
  applyToolResult,
  closeStreaming,
  commandOutputLayout,
  hasPermissionBlock,
  hasVisibleContent,
  mapPermissionToView,
  resolvePermissionBlock,
  pendingToolName,
  restartingText,
  turnUsageText,
} from './engineBlocks';
import type { Block } from './types';

function toolUse(overrides: Partial<ToolUse> = {}): ToolUse {
  return { toolUseId: 't1', toolName: 'Bash', input: { command: 'echo hola' }, ...overrides };
}

function toolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return { toolUseId: 't1', isError: false, output: 'hola', durationMs: 1200, ...overrides };
}

function permission(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: {}, description: null, requiresUserInteraction: false, displayName: null, ...overrides };
}

describe('appendDelta', () => {
  it('appendDelta_noStreaming_createsAgentBlock', () => {
    const { blocks, streamingId } = appendDelta([], null, 'hola', 'a1');

    expect(streamingId).toBe('a1');
    expect(blocks).toEqual([{ kind: 'agent', id: 'a1', runs: [{ code: false, text: 'hola' }], streaming: true }]);
  });

  it('appendDelta_streaming_appendsToExistingRun', () => {
    const first = appendDelta([], null, 'hola', 'a1');

    const second = appendDelta(first.blocks, first.streamingId, ' mundo', 'a2');

    expect(second.streamingId).toBe('a1'); // sigue el mismo bloque, no crea otro
    const agent = second.blocks[0] as Extract<Block, { kind: 'agent' }>;
    expect(agent.runs).toEqual([{ code: false, text: 'hola mundo' }]);
  });

  it('appendDelta_deltaVacioSinStreaming_noCreaBloqueFantasma', () => {
    const { blocks, streamingId } = appendDelta([], null, '', 'a1');

    expect(blocks).toEqual([]);
    expect(streamingId).toBeNull();
  });

  it('appendDelta_deltaVacioConStreaming_noRompeElBloqueEnCurso', () => {
    const first = appendDelta([], null, 'hola', 'a1');

    const second = appendDelta(first.blocks, first.streamingId, '', 'a2');

    expect(second.streamingId).toBe('a1');
    expect(second.blocks).toHaveLength(1);
  });
});

describe('closeStreaming', () => {
  it('closeStreaming_marksNotStreaming', () => {
    const { blocks, streamingId } = appendDelta([], null, 'x', 'a1');

    const closed = closeStreaming(blocks, streamingId);

    expect((closed[0] as Extract<Block, { kind: 'agent' }>).streaming).toBe(false);
  });

  it('closeStreaming_nullId_returnsSameBlocks', () => {
    const blocks: readonly Block[] = [{ kind: 'user', id: 'u1', text: 'hi', time: '10:00', attachments: [] }];

    expect(closeStreaming(blocks, null)).toBe(blocks);
  });
});

describe('appendToolUse', () => {
  it('appendToolUse_createsToolBlockWithToolUseIdAndCommand', () => {
    const blocks = appendToolUse([], toolUse(), 'b1');

    expect(blocks).toEqual([
      {
        kind: 'tool',
        id: 'b1',
        toolUseId: 't1',
        tool: 'Bash',
        toolClass: 'command',
        command: 'echo hola',
        meta: '',
        isError: false,
        output: [],
        filePath: null,
        diff: null,
        writtenContent: null,
        artifact: null,
        artifactDraft: null,
        parentToolUseId: null,
      },
    ]);
  });
});

describe('applyToolResult', () => {
  it('applyToolResult_matchingId_fillsMetaAndOutput', () => {
    const blocks = appendToolUse([], toolUse(), 'b1');

    const next = applyToolResult(blocks, toolResult({ output: 'hola' }));

    const tool = next[0] as Extract<Block, { kind: 'tool' }>;
    expect(tool.meta).toBe('ok · 1.2 s');
    expect(tool.output).toEqual([{ code: false, text: 'hola' }]);
  });

  it('applyToolResult_bashExitCode_metaShowsExit', () => {
    const blocks = appendToolUse([], toolUse(), 'b1');

    const next = applyToolResult(blocks, toolResult({ output: 'fallo\nExit code 1', isError: false }));

    expect((next[0] as Extract<Block, { kind: 'tool' }>).meta).toBe('exit 1 · 1.2 s');
  });

  it('applyToolResult_error_metaShowsError', () => {
    const blocks = appendToolUse([], toolUse(), 'b1');

    const next = applyToolResult(blocks, toolResult({ output: 'boom', isError: true, durationMs: null }));

    expect((next[0] as Extract<Block, { kind: 'tool' }>).meta).toBe('error');
  });

  it('applyToolResult_withFileContent_setsPathAndWrittenContent', () => {
    const blocks = appendToolUse([], toolUse({ toolName: 'Write' }), 'b1');

    const next = applyToolResult(
      blocks,
      toolResult({ output: 'File created', file: { path: '/tmp/a.txt', content: 'l1\nl2', structuredPatch: null } }),
    );

    const tool = next[0] as Extract<Block, { kind: 'tool' }>;
    expect(tool.filePath).toBe('/tmp/a.txt');
    // Un Write que CREA fichero no tiene diff: se guarda el contenido, que es lo que hay que enseñar.
    expect(tool.writtenContent).toEqual(['l1', 'l2']);
    expect(tool.diff).toBeNull();
  });

  it('applyToolResult_conStructuredPatch_numeraElDiff', () => {
    const blocks = appendToolUse([], toolUse({ toolName: 'Edit' }), 'b1');

    const next = applyToolResult(
      blocks,
      toolResult({
        file: {
          path: '/tmp/b.ts',
          content: null,
          // El patch llega SIN interpretar desde main, y lo numera el unico parser del renderer.
          structuredPatch: [{ oldStart: 13, oldLines: 2, newStart: 13, newLines: 2, lines: ['-a', '+b'] }],
        },
      }),
    );

    expect((next[0] as Extract<Block, { kind: 'tool' }>).diff).toEqual([
      { sign: '-', text: 'a', oldLine: 13, newLine: null },
      { sign: '+', text: 'b', oldLine: null, newLine: 13 },
    ]);
  });

  it('applyToolResult_conError_loMarcaExplicitamente', () => {
    // `isError` explicito: de el depende que una tool con fallo NO se esconda dentro de una racha.
    const blocks = appendToolUse([], toolUse({ toolName: 'Read' }), 'b1');

    const next = applyToolResult(blocks, toolResult({ isError: true, output: 'boom' }));

    expect((next[0] as Extract<Block, { kind: 'tool' }>).isError).toBe(true);
  });

  it('applyToolResult_noMatch_returnsUnchanged', () => {
    const blocks = appendToolUse([], toolUse({ toolUseId: 't1' }), 'b1');

    const next = applyToolResult(blocks, toolResult({ toolUseId: 'otro' }));

    expect(next).toEqual(blocks);
  });
});

describe('mapPermissionToView', () => {
  it('mapPermissionToView_codexAltaMedida_muestraRutaYContenidoSinInventarLineas', () => {
    const view = mapPermissionToView(permission({ toolName: 'apply_patch', input: {
      changes: [{ path: 'mage-edit.txt', kind: { type: 'add' }, diff: 'MAGE_EDIT_OK\n' }],
    } }));
    expect(view.target).toBe('apply_patch mage-edit.txt');
    expect(view.summary).toBe('+1 −0');
    expect(view.diff).toContainEqual({ sign: '+', text: 'MAGE_EDIT_OK', oldLine: null, newLine: null });
  });

  it('mapPermissionToView_codexDiffVariasRutas_conservaBorradosYAdiciones', () => {
    const view = mapPermissionToView(permission({ toolName: 'apply_patch', input: { changes: [
      { path: 'a', kind: { type: 'update' }, diff: '--- a\n+++ a\n@@ -1 +1 @@\n-antes\n+despues\n' },
      { path: 'b', kind: { type: 'delete' }, diff: 'borrado\n' },
    ] } }));
    expect(view.target).toBe('apply_patch a, b');
    expect(view.summary).toBe('+1 −2');
    expect(view.diff.map((line) => line.text)).toEqual(['a', '@@ -1 +1 @@', 'antes', 'despues', 'b', 'borrado']);
  });
  it('mapPermissionToView_codexEntradaInvalida_devuelveDiffVacio', () => {
    const view = mapPermissionToView(permission({ toolName: 'apply_patch', input: { changes: [null] } }));

    expect(view.diff).toEqual([]);
  });
  it('mapPermissionToView_outsideProject_notRememberableAndSummaryIsReason', () => {
    const view = mapPermissionToView({ ...permission({ toolName: 'Read', input: { file_path: '/etc/hosts' } }), description: 'Fuera del proyecto: /etc/hosts', outsideProject: true });

    expect(view).toMatchObject({ rememberable: false, summary: 'Fuera del proyecto: /etc/hosts' });
  });

  it('mapPermissionToView_normalRequest_rememberable', () => {
    expect(mapPermissionToView(permission({ toolName: 'Read', input: { file_path: 'a' } })).rememberable).toBe(true);
  });

  it('mapPermissionToView_edit_buildsDiffAndSummary', () => {
    const view = mapPermissionToView(
      permission({ toolName: 'Edit', input: { file_path: 'a.ts', old_string: 'a', new_string: 'b\nc' } }),
    );

    expect(view.target).toBe('Edit a.ts');
    expect(view.toolLabel).toBe('Edit');
    // SIN numeros: este diff sale del INPUT de la tool, que no dice por que linea del fichero va.
    expect(view.diff).toEqual([
      { sign: '-', text: 'a', oldLine: null, newLine: null },
      { sign: '+', text: 'b', oldLine: null, newLine: null },
      { sign: '+', text: 'c', oldLine: null, newLine: null },
    ]);
    expect(view.summary).toBe('+2 −1');
  });

  it('mapPermissionToView_write_diffFromContent', () => {
    const view = mapPermissionToView(
      permission({ toolName: 'Write', input: { file_path: 'a.ts', content: 'l1\nl2' } }),
    );

    expect(view.prompt).toBe('El agente quiere escribir en el proyecto:');
    expect(view.diff).toEqual([
      { sign: '+', text: 'l1', oldLine: null, newLine: null },
      { sign: '+', text: 'l2', oldLine: null, newLine: null },
    ]);
    expect(view.summary).toBe('+2 −0');
  });

  it('mapPermissionToView_bash_targetIsCommandAndNoDiff', () => {
    const view = mapPermissionToView(permission({ toolName: 'Bash', input: { command: 'rm -rf x' } }));

    expect(view.prompt).toBe('El agente quiere ejecutar un comando:');
    expect(view.target).toBe('Bash rm -rf x');
    expect(view.diff).toEqual([]);
  });
});

describe('appendUserBlock / appendErrorBlock', () => {
  it('appendUserBlock_addsUserBlock', () => {
    expect(appendUserBlock([], { id: 'u1', text: 'hola', time: '14:31', attachments: [] })).toEqual([
      { kind: 'user', id: 'u1', text: 'hola', time: '14:31', attachments: [] },
    ]);
  });

  it('appendUserBlock_conAdjuntos_losConserva', () => {
    // La ruta VIVA aun no manda imagenes (es de la Fase E), pero el bloque tiene que ser el mismo que
    // construye la ruta hidratada desde la transcripcion.
    const attachments = [{ mediaType: 'image/png', data: 'AAAA' }] as const;

    const blocks = appendUserBlock([], { id: 'u1', text: 'mira', time: '14:31', attachments });

    expect(blocks[0]).toEqual({ kind: 'user', id: 'u1', text: 'mira', time: '14:31', attachments });
  });

  it('appendErrorBlock_addsErrorBlock', () => {
    expect(appendErrorBlock([], 'algo falló', 'e1')).toEqual([{ kind: 'error', id: 'e1', message: 'algo falló' }]);
  });
});

describe('appendSystemBlock / compactionText', () => {
  it('appendSystemBlock_anadeMarcadorAlFinal', () => {
    const existing = appendUserBlock([], { id: 'u1', text: 'hola', time: '14:31', attachments: [] });

    const blocks = appendSystemBlock(existing, '🗜 Contexto compactado (manual)', 's1');

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ kind: 'system', id: 's1', text: '🗜 Contexto compactado (manual)' });
  });



});

describe('restartingText', () => {
  it('restartingText_primerIntento_indicaEsperaEnSegundos', () => {
    expect(restartingText(1, 1_000)).toBe('⟳ El agente se cerró; reanudando la conversación en 1.0 s (intento 1)');
  });

  it('restartingText_esperaConDecimas_redondeaADecimas', () => {
    expect(restartingText(2, 1_540)).toContain('1.5 s');
    expect(restartingText(2, 1_549)).toContain('1.5 s');
  });

  it('restartingText_esperaCero_muestraCeroSegundos', () => {
    expect(restartingText(1, 0)).toContain('0.0 s');
  });

  it('restartingText_intentoInvalido_lanza', () => {
    // El contrato de error exige que el mensaje incluya el valor recibido.
    expect(() => restartingText(0, 1_000)).toThrow(/intento invalido.*: 0$/i);
    expect(() => restartingText(1.5, 1_000)).toThrow(/intento invalido.*: 1\.5$/i);
  });

  it('restartingText_esperaInvalida_lanza', () => {
    expect(() => restartingText(1, -1)).toThrow(/espera invalida.*: -1$/i);
    expect(() => restartingText(1, Number.NaN)).toThrow(/espera invalida.*: NaN$/i);
  });
});

describe('hasVisibleContent', () => {
  it('bloquesConTexto_seMuestran', () => {
    expect(hasVisibleContent({ kind: 'user', id: 'u', text: 'hola', time: '10:00', attachments: [] })).toBe(true);
    expect(hasVisibleContent({ kind: 'error', id: 'e', message: 'boom' })).toBe(true);
    expect(hasVisibleContent({ kind: 'system', id: 's', text: 'compactado' })).toBe(true);
    expect(hasVisibleContent({ kind: 'agent', id: 'a', runs: [{ code: false, text: 'texto' }], streaming: false })).toBe(true);
  });

  it('bloquesVacios_seOcultan_evitaRayasFantasma', () => {
    expect(hasVisibleContent({ kind: 'user', id: 'u', text: '   ', time: '', attachments: [] })).toBe(false);
    expect(hasVisibleContent({ kind: 'error', id: 'e', message: '' })).toBe(false);
    expect(hasVisibleContent({ kind: 'system', id: 's', text: '' })).toBe(false);
    expect(hasVisibleContent({ kind: 'agent', id: 'a', runs: [{ code: false, text: '\n\n' }], streaming: false })).toBe(false);
  });

  it('agenteEnStreamingVacio_siSeMuestra', () => {
    expect(hasVisibleContent({ kind: 'agent', id: 'a', runs: [], streaming: true })).toBe(true);
  });

  it('hasVisibleContent_usuarioSinTextoConAdjunto_seMuestra', () => {
    // Un mensaje que era SOLO una imagen: con la condicion anterior (solo texto) desaparecia del hilo.
    const block: Block = { kind: 'user', id: 'u', text: '', time: '10:00', attachments: [{ mediaType: 'image/png', data: 'AAAA' }] };

    expect(hasVisibleContent(block)).toBe(true);
  });

  it('hasVisibleContent_usuarioSinTextoNiAdjuntos_seOculta', () => {
    expect(hasVisibleContent({ kind: 'user', id: 'u', text: '', time: '10:00', attachments: [] })).toBe(false);
  });

  it('toolSinNombre_seOculta', () => {
    const base = {
      kind: 'tool',
      id: 't',
      toolUseId: 'x',
      toolClass: 'command',
      command: '',
      meta: '',
      isError: false,
      output: [],
      filePath: null,
      diff: null,
      writtenContent: null,
      artifact: null,
      artifactDraft: null,
      parentToolUseId: null,
    } as const;
    expect(hasVisibleContent({ ...base, tool: 'Bash' })).toBe(true);
    expect(hasVisibleContent({ ...base, tool: '' })).toBe(false);
  });
});

describe('pendingToolName', () => {
  const tool = (over: Partial<Extract<Block, { kind: 'tool' }>>): Block => ({
    kind: 'tool',
    id: 't1',
    toolUseId: 'u1',
    tool: 'Write',
    toolClass: 'edit',
    command: 'a.ts',
    meta: '',
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

  it('sinBloques_devuelveNull', () => {
    expect(pendingToolName([])).toBeNull();
  });

  it('ultimaToolSinMeta_devuelveSuNombre', () => {
    expect(pendingToolName([tool({ tool: 'Read' })])).toBe('Read');
  });

  it('ultimaToolYaResuelta_devuelveNull', () => {
    expect(pendingToolName([tool({ meta: 'ok · 12 ms' })])).toBeNull();
  });

  it('ignoraBloquesQueNoSonTool_yMiraLaUltima', () => {
    const blocks: Block[] = [
      tool({ id: 't1', meta: 'ok' }),
      tool({ id: 't2', tool: 'Bash' }),
      { kind: 'agent', id: 'a1', runs: [{ code: false, text: 'x' }], streaming: false },
    ];
    expect(pendingToolName(blocks)).toBe('Bash');
  });
});

// Uso de UN turno (E3): hoy solo lo reporta `agy`. Es la unica forma de ver su gasto, porque el panel
// de Uso lee el historial de la cuenta de Claude y no sabe nada de otros proveedores.
describe('turnUsageText', () => {
  const full: TurnUsage = {
    inputTokens: 17533,
    outputTokens: 7,
    totalTokens: 17540,
    thinkingTokens: 112,
    cacheReadTokens: 24410,
  };

  it('turnUsageText_estimado_loDiceEnElTexto', () => {
    expect(turnUsageText({ ...full, estimated: true })).toMatch(/^◷ Tokens del turno \(estimados\): /);
  });

  it('turnUsageText_todosLosContadores_losListaEnOrden', () => {
    const text = turnUsageText(full);

    expect(text).toBe(
      `◷ Tokens del turno: ${(17533).toLocaleString('es-ES')} entrada · 7 salida · 112 pensamiento · ` +
        `${(24410).toLocaleString('es-ES')} caché · ${(17540).toLocaleString('es-ES')} total`,
    );
  });

  // "No lo reporta" y "gasto cero" no son lo mismo: lo ausente se omite, no se pinta como 0.
  it('turnUsageText_contadoresAusentes_seOmitenEnVezDePintarCero', () => {
    const text = turnUsageText({ ...full, thinkingTokens: null, cacheReadTokens: null });

    expect(text).not.toContain('pensamiento');
    expect(text).not.toContain('caché');
    expect(text).toContain('entrada');
  });

  it('turnUsageText_cero_siSeReportaSePinta', () => {
    expect(turnUsageText({ inputTokens: 0, outputTokens: 0, totalTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 })).toContain(
      '0 entrada',
    );
  });

  it('turnUsageText_sinNingunContador_devuelveNull', () => {
    expect(
      turnUsageText({ inputTokens: null, outputTokens: null, totalTokens: null, thinkingTokens: null, cacheReadTokens: null }),
    ).toBeNull();
  });

  it.each([-1, 1.5, Number.NaN])('turnUsageText_contadorInvalido_%s_lanzaConElValorRecibido', (value) => {
    expect(() => turnUsageText({ ...full, inputTokens: value })).toThrow(/entrada/);
  });
});

describe('subagentes y pensamiento (2.5)', () => {
  const task = { toolUseId: 'tu1', toolName: 'Task', input: { subagent_type: 'Explore', description: 'buscar el bug' } };

  it('appendSubagentBlock_creaElBloqueSinAgentIdTodavia', () => {
    const blocks = appendSubagentBlock([], task, 's1');

    expect(blocks[0]).toEqual({
      kind: 'subagent',
      id: 's1',
      toolUseId: 'tu1',
      agentType: 'Explore',
      description: 'buscar el bug',
      // Llega con el tool_result: hasta entonces no se puede abrir su transcripcion.
      agentId: null,
      status: null,
      elapsedMs: null,
      tokens: null,
      toolUses: null,
      model: null,
    });
  });

  it('applySubagentResult_asyncLaunched_sigueEnMarcha', () => {
    // Forma medida en 2.1.284: el resultado de un Agent en segundo plano solo dice que se lanzo.
    const blocks = appendSubagentBlock([], task, 's1');
    const subagent = { status: 'async_launched', agentId: 'ab25', model: 'claude-haiku-4-5', totalTokens: null, totalDurationMs: null, totalToolUseCount: null };

    const next = applySubagentResult(blocks, { toolUseId: 'tu1', isError: false, output: 'Async agent launched successfully.', durationMs: 4, subagent });

    expect(next[0]).toMatchObject({ status: 'en segundo plano', agentId: 'ab25', model: 'claude-haiku-4-5', elapsedMs: null });
    expect(isSubagentRunning(next[0] as Extract<Block, { kind: 'subagent' }>)).toBe(true);
  });

  it('applySubagentResult_primerPlano_guardaTokensHerramientasYDuracionDelCli', () => {
    const blocks = appendSubagentBlock([], task, 's1');
    const subagent = { status: 'completed', agentId: 'a1', model: null, totalTokens: 1200, totalDurationMs: 8000, totalToolUseCount: 3 };

    const next = applySubagentResult(blocks, { toolUseId: 'tu1', isError: false, output: '', durationMs: 8100, subagent });

    expect(next[0]).toMatchObject({ status: 'completado', tokens: 1200, toolUses: 3, elapsedMs: 8000 });
  });

  it('applySubagentResult_textoMedidoSinComillas_extraeElAgentId', () => {
    // Texto real del resultado (2.1.284): `agentId: <id> (internal ID…`, sin comillas.
    const blocks = appendSubagentBlock([], task, 's1');

    const next = applySubagentResult(blocks, { toolUseId: 'tu1', isError: false, output: 'Done.\nagentId: af3b49b855c7f949e (internal ID - do not mention)', durationMs: null });

    expect(next[0]).toMatchObject({ agentId: 'af3b49b855c7f949e', status: 'completado' });
  });

  it('applySubagentUpdate_progreso_sigueEnMarchaConContadores', () => {
    const blocks = applySubagentResult(appendSubagentBlock([], task, 's1'), { toolUseId: 'tu1', isError: false, output: '', durationMs: 1, subagent: { status: 'async_launched', agentId: 'b', model: null, totalTokens: null, totalDurationMs: null, totalToolUseCount: null } });

    const next = applySubagentUpdate(blocks, { toolUseId: 'tu1', status: 'running', tokens: 19954, toolUses: 1, durationMs: 5228 });

    expect(next[0]).toMatchObject({ status: 'en segundo plano', tokens: 19954, toolUses: 1, elapsedMs: null });
  });

  it.each([
    ['completed', 'completado'],
    ['stopped', 'detenido'],
    ['failed', 'error'],
  ])('applySubagentUpdate_notificacion_%s_cierraComo_%s', (status, expected) => {
    const blocks = appendSubagentBlock([], task, 's1');

    const next = applySubagentUpdate(blocks, { toolUseId: 'tu1', status, tokens: 19906, toolUses: 0, durationMs: 1422 });

    expect(next[0]).toMatchObject({ status: expected, tokens: 19906, toolUses: 0, elapsedMs: 1422 });
  });

  it('applySubagentUpdate_sinCoincidencia_noCambiaNada', () => {
    const blocks = appendSubagentBlock([], task, 's1');

    expect(applySubagentUpdate(blocks, { toolUseId: 'otro', status: 'completed', tokens: null, toolUses: null, durationMs: null })).toBe(blocks);
  });

  it('applySubagentResult_conAgentId_loGuardaYMarcaCompletado', () => {
    const blocks = appendSubagentBlock([], task, 's1');

    const next = applySubagentResult(blocks, {
      toolUseId: 'tu1',
      isError: false,
      output: '{"agentId":"agent-42","status":"completed"}',
      durationMs: null,
    });

    expect(next[0]).toMatchObject({ agentId: 'agent-42', status: 'completado' });
  });

  it('applySubagentResult_conDuracion_laGuarda', () => {
    const blocks = appendSubagentBlock([], task, 's1');

    const next = applySubagentResult(blocks, { toolUseId: 'tu1', isError: true, output: '', durationMs: 9000 });

    expect(next[0]).toMatchObject({ status: 'error', elapsedMs: 9000 });
  });

  it('applySubagentResult_sinCoincidencia_noCambiaNada', () => {
    const blocks = appendSubagentBlock([], task, 's1');

    expect(applySubagentResult(blocks, { toolUseId: 'otro', isError: false, output: '', durationMs: null })).toBe(blocks);
  });

  it('appendThinkingDelta_deltaVacio_noAbreBloque', () => {
    // Mismo patron anti-fantasma que appendDelta: un delta vacio dejaba una raya suelta en el chat.
    expect(appendThinkingDelta([], '', 'th1')).toEqual([]);
  });

  it('appendThinkingDelta_variosDeltas_acumulanEnElMismoBloque', () => {
    const first = appendThinkingDelta([], 'a ver', 'th1');

    const next = appendThinkingDelta(first, '… vale', 'th2');

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: 'thinking', id: 'th1', streaming: true });
  });

  it('closeThinking_cierraElBloqueYAnotaLaDuracion', () => {
    const blocks = appendThinkingDelta([], 'mmm', 'th1');

    const next = closeThinking(blocks, 12_000);

    expect(next[0]).toMatchObject({ streaming: false, elapsedMs: 12_000 });
  });

  it('closeThinking_sinBloqueEnCurso_noCambiaNada', () => {
    const blocks = appendUserBlock([], { id: 'u1', text: 'hola', time: '', attachments: [] });

    expect(closeThinking(blocks, 1)).toBe(blocks);
  });

  it('hasVisibleContent_thinkingVacioNoStreaming_seMuestra', () => {
    // El "▸ Pensó" SIN texto es lo que queda al reanudar una conversacion (el CLI no persiste el texto):
    // esconderlo borraria del hilo que el agente penso.
    expect(hasVisibleContent({ kind: 'thinking', id: 't', runs: [], streaming: false, elapsedMs: null })).toBe(true);
  });

  it('hasVisibleContent_subagente_seMuestra', () => {
    const block: Block = { kind: 'subagent', id: 's', toolUseId: 'u', agentType: null, description: null, agentId: null, status: null, elapsedMs: null, tokens: null, toolUses: null, model: null };

    expect(hasVisibleContent(block)).toBe(true);
  });
});

describe('tarjeta de permiso en el chat (2.3b)', () => {
  const carta = { id: 'b1', requestId: 'r1', toolName: 'Write', prompt: 'El agente quiere escribir en el proyecto:', target: 'Write a.ts', summary: '+2 −0' };

  it('appendPermissionBlock_peticionNueva_dejaLaTarjetaPendiente', () => {
    const blocks = appendPermissionBlock([], carta);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'permission', requestId: 'r1', toolName: 'Write', state: 'pending' });
  });

  it('hasPermissionBlock_mismoRequestId_true', () => {
    const blocks = appendPermissionBlock([], carta);
    expect(hasPermissionBlock(blocks, 'r1')).toBe(true);
    expect(hasPermissionBlock(blocks, 'r2')).toBe(false);
  });

  it('resolvePermissionBlock_tarjetaPendiente_guardaLaDecision', () => {
    const blocks = resolvePermissionBlock(appendPermissionBlock([], carta), 'r1', 'allowed');
    expect(blocks[0]).toMatchObject({ kind: 'permission', state: 'allowed' });
  });

  it('resolvePermissionBlock_sinTarjetaPendiente_devuelveElMismoArray', () => {
    // Contrato compartido con `cancelQuestionBlock`: sin nada que cambiar, el reducer no emite parche.
    const blocks = appendPermissionBlock([], carta);
    expect(resolvePermissionBlock(blocks, 'otra', 'denied')).toBe(blocks);
  });

  it('resolvePermissionBlock_tarjetaYaCerrada_noLaReescribe', () => {
    // Una respuesta duplicada (o una cancelacion que llega tarde) no puede convertir un "permitido" en
    // "cancelado": el hilo tiene que contar lo que de verdad se decidio.
    const cerrada = resolvePermissionBlock(appendPermissionBlock([], carta), 'r1', 'allowed');
    expect(resolvePermissionBlock(cerrada, 'r1', 'cancelled')).toBe(cerrada);
  });

  it('hasVisibleContent_tarjetaDePermisoCancelada_true', () => {
    // La tarjeta es contenido del hilo aunque nadie la contestara: es la traza de que se pidio permiso.
    const cancelada = resolvePermissionBlock(appendPermissionBlock([], carta), 'r1', 'cancelled')[0] as Block;
    expect(hasVisibleContent(cancelada)).toBe(true);
  });
});

// P-028: como se pinta la salida de un comando local.
describe('commandOutputLayout', () => {
  it('commandOutputLayout_unaLinea_line', () => {
    expect(commandOutputLayout('Session renamed to: X')).toBe('line');
    expect(commandOutputLayout('  hola \n')).toBe('line');
  });

  it('commandOutputLayout_tablaOTitulo_markdown', () => {
    expect(commandOutputLayout('## Context Usage\n| a | b |\n|---|---|\n| 1 | 2 |')).toBe('markdown');
    expect(commandOutputLayout('texto\n# Titulo')).toBe('markdown');
  });

  it('commandOutputLayout_columnasConEspacios_pre', () => {
    expect(commandOutputLayout('Skill      Tokens\ncaveman    1200')).toBe('pre');
  });
});
