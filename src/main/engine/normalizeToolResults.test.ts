import { describe, expect, it } from 'vitest';
import { normalizeRawEvent } from './normalize';

// Los `user` con `tool_result`: texto plano, error, bloques anidados, varios por mensaje, y la
// extraccion de fichero/diff de Write y Edit.
describe('normalizeRawEvent: resultados de herramienta', () => {
  it('normalize_bashToolResult_returnsToolResultEvent', () => {
    // Bash: content string; is_error ausente -> false; durationMs null (lo mide AgentSession).
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hola\nExit code 0' }] },
      tool_use_result: { stdout: 'hola', stderr: '', interrupted: false },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'tool_result', result: { toolUseId: 't1', isError: false, output: 'hola\nExit code 0', durationMs: null } },
    ]);
  });

  it('normalize_toolResultIsError_flagsError', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }] },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'tool_result', result: { toolUseId: 't2', isError: true, output: 'boom', durationMs: null } },
    ]);
  });

  it('normalize_toolResultContentAsBlocks_flattensText', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't3',
            content: [{ type: 'text', text: 'linea1 ' }, { type: 'text', text: 'linea2' }, { type: 'image' }],
          },
        ],
      },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'tool_result', result: { toolUseId: 't3', isError: false, output: 'linea1 linea2[imagen]', durationMs: null } },
    ]);
  });

  it('normalize_multipleToolResults_returnsOnePerBlock', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'A' },
          { type: 'tool_result', tool_use_id: 'b', content: 'B' },
        ],
      },
    };

    const events = normalizeRawEvent(raw);

    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.kind === 'tool_result' ? e.result.toolUseId : null))).toEqual(['a', 'b']);
  });

  it('normalize_writeToolResult_extractsFileContent', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'File created' }] },
      tool_use_result: { type: 'create', filePath: '/tmp/a.txt', content: 'hola\nmundo', structuredPatch: [] },
    };

    const events = normalizeRawEvent(raw);

    expect(events).toEqual([
      {
        kind: 'tool_result',
        result: {
          toolUseId: 'w1',
          isError: false,
          output: 'File created',
          durationMs: null,
          file: { path: '/tmp/a.txt', content: 'hola\nmundo', structuredPatch: [] },
        },
      },
    ]);
  });

  // Read devuelve la ruta ANIDADA en `file`, no en la raiz. Sin esto la UI no sabia de que fichero era
  // la lectura y la pintaba sin resaltado de sintaxis.
  it('normalize_readToolResult_extraeLaRutaAnidadaEnFile', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'const a = 1;' }] },
      tool_use_result: { type: 'text', file: { filePath: '/tmp/c.ts', content: 'const a = 1;', numLines: 1 } },
    };

    const events = normalizeRawEvent(raw);
    const result = events[0]!.kind === 'tool_result' ? events[0]!.result : null;

    // Solo la RUTA: el contenido ya viaja en `output`, y duplicarlo lo pintaria dos veces en el chat.
    expect(result?.file).toEqual({ path: '/tmp/c.ts', content: null, structuredPatch: null });
  });

  it('normalize_editToolResult_extractsDiffLines', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'updated' }] },
      tool_use_result: {
        filePath: '/tmp/b.ts',
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      },
    };

    const events = normalizeRawEvent(raw);
    const result = events[0]!.kind === 'tool_result' ? events[0]!.result : null;

    // El patch viaja SIN interpretar: aplanarlo aqui tiraba `oldStart`/`newStart`, que es justo lo que
    // el renderer necesita para numerar el diff. Lo interpreta su unico parser (`diffLines.ts`).
    expect(result?.file).toEqual({
      path: '/tmp/b.ts',
      content: null,
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    });
  });

  it('normalize_toolResultWithoutToolUseResult_hasNoFile', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'ok' }] },
    };

    const result = normalizeRawEvent(raw)[0];
    expect(result!.kind === 'tool_result' && 'file' in result!.result).toBe(false);
  });

  it('normalize_userWithoutToolResult_returnsEmpty', () => {
    // Un `user` normal (texto plano) o con bloques que no son tool_result -> nada que renderizar.
    expect(normalizeRawEvent({ type: 'user', message: { role: 'user', content: 'hola' } })).toEqual([]);
    expect(
      normalizeRawEvent({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hola' }] } }),
    ).toEqual([]);
  });
});
