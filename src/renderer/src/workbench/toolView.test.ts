import { describe, expect, it } from 'vitest';
import { extractToolResult, extractToolUses } from './toolView';
import { parseStructuredPatch } from './diffLines';
import { summarizeToolInput } from './toolSummary';
import type { TranscriptEntry } from '@shared/transcripts';
import { makeEntry } from '@testing/transcriptEntry';

// Fabrica una entrada con `kind` y `raw` dados (el resto de campos no influye en estas funciones).
function entry(kind: string, raw: unknown, index = 0): TranscriptEntry {
  return makeEntry({ kind, raw, index, summary: kind });
}

describe('extractToolUses', () => {
  it('assistantConVariosToolUse_losExtraeConResumen', () => {
    const raw = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'voy a ello' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la', description: 'listar' } },
          { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: 'C:\\a\\b.ts', old_string: 'x', new_string: 'y' } },
        ],
      },
    };

    const uses = extractToolUses(entry('assistant', raw));

    expect(uses).toHaveLength(2);
    expect(uses[0]).toMatchObject({ toolUseId: 'toolu_1', toolName: 'Bash', summary: 'ls -la' });
    expect(uses[1]).toMatchObject({ toolUseId: 'toolu_2', toolName: 'Edit', summary: 'C:\\a\\b.ts' });
  });

  it('assistantSoloTexto_devuelveVacio', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hola' }] } };
    expect(extractToolUses(entry('assistant', raw))).toEqual([]);
  });

  it('lineaNoAssistant_devuelveVacio', () => {
    const raw = { type: 'user', message: { role: 'user', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } };
    expect(extractToolUses(entry('user', raw))).toEqual([]);
  });

  it('bloqueToolUseSinId_seIgnora', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } };
    expect(extractToolUses(entry('assistant', raw))).toEqual([]);
  });
});

describe('extractToolResult', () => {
  it('editConStructuredPatch_devuelveDiffConSignos', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'The file has been updated' }] },
      toolUseResult: {
        filePath: 'C:\\a\\b.ts',
        structuredPatch: [{ oldStart: 19, oldLines: 1, newStart: 19, newLines: 3, lines: [' contexto', '+nueva', '-vieja'] }],
      },
    };

    const result = extractToolResult(entry('user', raw));

    expect(result?.toolUseId).toBe('toolu_2');
    expect(result?.isError).toBe(false);
    expect(result?.filePath).toBe('C:\\a\\b.ts');
    // Con numeros de linea (2.12.2): el contexto avanza los dos contadores, la adicion solo el nuevo y
    // el borrado solo el antiguo. Salen del propio hunk (`oldStart`/`newStart`), medidos.
    expect(result?.diff).toEqual([
      { sign: ' ', text: 'contexto', oldLine: 19, newLine: 19 },
      { sign: '+', text: 'nueva', oldLine: null, newLine: 20 },
      { sign: '-', text: 'vieja', oldLine: 20, newLine: null },
    ]);
  });

  it('writeCreate_devuelveWrittenContent', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: 'File created' }] },
      toolUseResult: { type: 'create', filePath: 'C:\\a\\c.ts', content: 'contenido nuevo', structuredPatch: [], originalFile: '' },
    };

    const result = extractToolResult(entry('user', raw));

    expect(result?.writtenContent).toBe('contenido nuevo');
    expect(result?.diff).toBeNull(); // structuredPatch vacio -> sin diff
  });

  it('bashConStdout_aplanaContentString', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'total 4\nfile.txt' }] },
      toolUseResult: { stdout: 'total 4\nfile.txt', stderr: '', interrupted: false },
    };

    const result = extractToolResult(entry('user', raw));

    expect(result?.output).toBe('total 4\nfile.txt');
    expect(result?.filePath).toBeNull();
    expect(result?.diff).toBeNull();
  });

  it('resultadoConError_isErrorTrue', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'boom', is_error: true }] },
    };
    expect(extractToolResult(entry('user', raw))?.isError).toBe(true);
  });

  it('contentArrayConBloquesTexto_seAplana', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: [{ type: 'text', text: 'Async agent launched' }] }],
      },
    };
    expect(extractToolResult(entry('user', raw))?.output).toBe('Async agent launched');
  });

  it('aceptaToolUseResultSnakeCasePorRobustez', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
      tool_use_result: { filePath: 'C:\\x.ts', structuredPatch: [{ lines: ['+a'] }] },
    };
    const result = extractToolResult(entry('user', raw));
    expect(result?.filePath).toBe('C:\\x.ts');
    // Hunk SIN `oldStart`/`newStart`: se pinta sin numeros en vez de inventarse un 1.
    expect(result?.diff).toEqual([{ sign: '+', text: 'a', oldLine: null, newLine: null }]);
  });

  it('userNormal_devuelveNull', () => {
    const raw = { type: 'user', message: { role: 'user', content: 'un mensaje normal' } };
    expect(extractToolResult(entry('user', raw))).toBeNull();
  });
});

describe('parseStructuredPatch', () => {
  it('variosHunks_insertaSeparadorEntreEllos', () => {
    const patch = [
      { lines: ['+a'] },
      { lines: ['-b'] },
    ];
    expect(parseStructuredPatch(patch)).toEqual([
      { sign: '+', text: 'a', oldLine: null, newLine: null },
      { sign: ' ', text: '⋯', oldLine: null, newLine: null },
      { sign: '-', text: 'b', oldLine: null, newLine: null },
    ]);
  });

  it('lineaNoNewlineAlFinal_vaComoContexto', () => {
    expect(parseStructuredPatch([{ lines: ['\\ No newline at end of file'] }])).toEqual([
      { sign: ' ', text: '\\ No newline at end of file', oldLine: null, newLine: null },
    ]);
  });

  it('noArray_devuelveNull', () => {
    expect(parseStructuredPatch(undefined)).toBeNull();
    expect(parseStructuredPatch('nope')).toBeNull();
  });

  it('arrayVacio_devuelveNull', () => {
    expect(parseStructuredPatch([])).toBeNull();
  });
});

describe('summarizeToolInput', () => {
  it('agentUsaTipoYDescripcion', () => {
    expect(summarizeToolInput('Agent', { subagent_type: 'Explore', description: 'Mapear datos' })).toBe('Explore · Mapear datos');
  });

  it('taskTambienUsaTipoYDescripcion', () => {
    expect(summarizeToolInput('Task', { subagent_type: 'general-purpose', description: 'algo' })).toBe('general-purpose · algo');
  });

  it('truncaResumenLargo', () => {
    const long = 'x'.repeat(200);
    const summary = summarizeToolInput('Bash', { command: long });
    expect(summary.length).toBeLessThan(200);
    expect(summary.endsWith('…')).toBe(true);
  });
});
