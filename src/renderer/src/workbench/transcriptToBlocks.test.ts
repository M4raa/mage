import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '@shared/transcripts';
import type { Block } from './types';
import { transcriptToBlocks } from './transcriptToBlocks';
import { makeEntry } from '@testing/transcriptEntry';

// Construye una entrada normalizada minima: solo `kind`, `index`, `raw` (y lo que se sobrescriba)
// importan aqui. Los dos campos sobrescribibles van en un objeto en vez de como parametros sueltos:
// son opcionales y del mismo "tipo de dato" (metadatos de la linea), no una lista posicional.
type EntryOverrides = Partial<Pick<TranscriptEntry, 'timestampMs' | 'isMeta'>>;

function entry(kind: string, raw: unknown, index: number, over: EntryOverrides = {}): TranscriptEntry {
  return makeEntry({ kind, raw, index, ...over });
}

const userMsg = (text: string, index: number): TranscriptEntry =>
  entry('user', { type: 'user', message: { role: 'user', content: text } }, index);

const assistantText = (text: string, index: number): TranscriptEntry =>
  entry('assistant', { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }, index);

const assistantToolUse = (id: string, name: string, input: Record<string, unknown>, index: number): TranscriptEntry =>
  entry('assistant', { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }, index);

const toolResult = (toolUseId: string, output: string, index: number, extra: Record<string, unknown> = {}): TranscriptEntry =>
  entry(
    'user',
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: output }] }, ...extra },
    index,
  );

// --- Las tres entradas REALES de PLAN-NO-TOCAR.md §2.12 (indices 5, 12 y 61 de 9253933c-…) ---------
//
// Copiadas con su forma exacta: el mensaje unico con [text, image], el aviso `isMeta` de la imagen
// pegada (la "segunda burbuja Tú" de img_6) y el `<system-reminder>` de img_10. Lo que importa aqui es
// la FORMA, asi que la imagen va con un PNG minimo real en vez de los 34 KB del original; las lineas
// completas (con su base64 de verdad) viven en `src/main/transcripts/fixtures/meta-and-image.jsonl`,
// que leen `normalize.test.ts` y la comprobacion 3 de `pnpm verify:gui` — esa es la que necesita que el
// `data:` decodifique de verdad.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const IMAGE_PASTE_TEXT = String.raw`[Image: source: C:\Users\usuario\.claude-p\image-cache\9253933c-a6b0-4c70-84a5-e92f45c8adb4\2.png]`;
const SYSTEM_REMINDER_TEXT =
  '<system-reminder>\nThe user named this session "Mage". This may indicate the session\'s focus or intent.\n</system-reminder>';

// Entrada 5: un SOLO mensaje del usuario con texto + imagen, y SIN campo `isMeta` (no lo trae).
const userTextAndImage = (index: number, mediaType = 'image/png', data = TINY_PNG_BASE64): TranscriptEntry =>
  entry(
    'user',
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'he hecho:' },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        ],
      },
    },
    index,
  );

describe('transcriptToBlocks', () => {
  it('mensajeUsuario_generaBloqueUser', () => {
    const blocks = transcriptToBlocks([userMsg('hola', 0)]);

    expect(blocks).toEqual([{ kind: 'user', id: 'tb-0-0', text: 'hola', time: '', attachments: [] }]);
  });

  it('textoAsistente_generaBloqueAgentNoStreaming', () => {
    const blocks = transcriptToBlocks([assistantText('respuesta', 1)]);

    expect(blocks[0]).toEqual({ kind: 'agent', id: 'tb-1-0', runs: [{ code: false, text: 'respuesta' }], streaming: false });
  });

  it('toolUseYSuResult_emparejaYRellenaElBloqueTool', () => {
    const blocks = transcriptToBlocks([
      assistantToolUse('tu1', 'Bash', { command: 'ls -la' }, 2),
      toolResult('tu1', 'total 0', 3),
    ]);

    expect(blocks).toHaveLength(1);
    const tool = blocks[0] as Extract<(typeof blocks)[number], { kind: 'tool' }>;
    expect(tool.kind).toBe('tool');
    expect(tool.tool).toBe('Bash');
    expect(tool.command).toContain('ls -la');
    expect(tool.meta).toBe('ok');
    expect(tool.output).toEqual([{ code: false, text: 'total 0' }]);
  });

  it('toolResultDeFichero_poneContenidoYRuta', () => {
    const blocks = transcriptToBlocks([
      assistantToolUse('tu9', 'Write', { file_path: '/p/a.ts' }, 4),
      toolResult('tu9', 'ok', 5, { toolUseResult: { filePath: '/p/a.ts', content: 'line1\nline2' } }),
    ]);

    const tool = blocks[0] as Extract<(typeof blocks)[number], { kind: 'tool' }>;
    expect(tool.filePath).toBe('/p/a.ts');
    expect(tool.writtenContent).toEqual(['line1', 'line2']);
  });

  it('toolResultHuerfano_seIgnoraSinCrear', () => {
    const blocks = transcriptToBlocks([toolResult('desconocido', 'x', 0)]);

    expect(blocks).toHaveLength(0);
  });

  it('metadataYUnknown_seIgnoran', () => {
    const blocks = transcriptToBlocks([entry('mode', { type: 'mode' }, 0), entry('file-history-snapshot', {}, 1)]);

    expect(blocks).toHaveLength(0);
  });

  it('conversacionCompleta_mantieneElOrden', () => {
    const blocks = transcriptToBlocks([
      userMsg('haz X', 0),
      assistantText('voy a mirar', 1),
      assistantToolUse('t1', 'Bash', { command: 'ls' }, 2),
      toolResult('t1', 'salida', 3),
      assistantText('hecho', 4),
    ]);

    expect(blocks.map((b) => b.kind)).toEqual(['user', 'agent', 'tool', 'agent']);
  });

  it('timestamp_seFormateaComoHoraSiViene', () => {
    const withTs = entry('user', { type: 'user', message: { role: 'user', content: 'hi' } }, 0, { timestampMs: 1_700_000_000_000 });
    const block = transcriptToBlocks([withTs])[0] as Extract<Block, { kind: 'user' }>;

    expect(block.time).toMatch(/^\d{2}:\d{2}$/);
  });
});

// --- 2.12.3: las entradas que el CLI inyecta para su contabilidad no son conversacion ---------------

describe('transcriptToBlocks — filtro isMeta', () => {
  it('transcriptToBlocks_entradaIsMetaTrue_seDescarta', () => {
    const blocks = transcriptToBlocks([entry('user', { type: 'user', message: { role: 'user', content: 'oculto' } }, 0, { isMeta: true })]);

    expect(blocks).toHaveLength(0);
  });

  it('transcriptToBlocks_entradaIsMetaFalse_siSeMuestra', () => {
    // MEDIDO: el campo aparece explicitamente como `false` en transcripciones reales. Un filtro "por
    // ausencia de false" o un `!== false` mal escrito esconderia mensajes reales del usuario.
    const blocks = transcriptToBlocks([entry('user', { type: 'user', message: { role: 'user', content: 'visible' } }, 0, { isMeta: false })]);

    expect(blocks).toHaveLength(1);
  });

  it('transcriptToBlocks_entradaSinCampoIsMeta_siSeMuestra', () => {
    const blocks = transcriptToBlocks([userMsg('visible', 0)]);

    expect(blocks).toHaveLength(1);
  });

  it('transcriptToBlocks_avisoDeImagenPegadaConIsMeta_noGeneraSegundaBurbuja', () => {
    // El sintoma exacto de img_6: el mensaje del usuario y, debajo, una segunda burbuja "Tú" con la
    // ruta del image-cache.
    const blocks = transcriptToBlocks([
      userTextAndImage(5),
      entry('user', { type: 'user', message: { role: 'user', content: [{ type: 'text', text: IMAGE_PASTE_TEXT }] } }, 12, { isMeta: true }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks)).not.toContain('[Image: source:');
  });

  it('transcriptToBlocks_systemReminderConIsMeta_noGeneraBurbuja', () => {
    // img_10: el recordatorio interno del CLI pintado como si lo hubiera escrito el usuario.
    const blocks = transcriptToBlocks([
      entry('user', { type: 'user', message: { role: 'user', content: SYSTEM_REMINDER_TEXT } }, 61, { isMeta: true }),
    ]);

    expect(blocks).toHaveLength(0);
  });

  it('transcriptToBlocks_asistenteConIsMeta_seDescarta', () => {
    // El filtro es de la ENTRADA, no del `kind`: si el CLI marcase una linea assistant como meta,
    // tampoco es conversacion.
    const blocks = transcriptToBlocks([entry('assistant', { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } }, 0, { isMeta: true })]);

    expect(blocks).toHaveLength(0);
  });
});

// --- 2.12.1 (mitad de pintar): la imagen viaja con el texto en el MISMO bloque ----------------------

describe('transcriptToBlocks — adjuntos de imagen', () => {
  it('transcriptToBlocks_mensajeConTextoEImagen_generaUnSoloBloqueConAdjunto', () => {
    const blocks = transcriptToBlocks([userTextAndImage(5)]);

    expect(blocks).toEqual([
      {
        kind: 'user',
        id: 'tb-5-0',
        text: 'he hecho:',
        time: '',
        attachments: [{ mediaType: 'image/png', data: TINY_PNG_BASE64 }],
      },
    ]);
  });

  it('transcriptToBlocks_mensajeSoloConImagen_generaBloqueVisible', () => {
    const soloImagen = entry(
      'user',
      { type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: TINY_PNG_BASE64 } }] } },
      7,
    );

    const blocks = transcriptToBlocks([soloImagen]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'user', text: '', attachments: [{ mediaType: 'image/webp' }] });
  });

  it('transcriptToBlocks_imagenConMediaTypeNoSoportado_descartaElAdjuntoYConservaElTexto', () => {
    const blocks = transcriptToBlocks([userTextAndImage(5, 'image/tiff')]);

    expect(blocks[0]).toEqual({ kind: 'user', id: 'tb-5-0', text: 'he hecho:', time: '', attachments: [] });
  });

  it('transcriptToBlocks_bloqueImageSinSourceBase64_noLanza', () => {
    const sinBase64 = entry(
      'user',
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'mira' }, { type: 'image', source: { type: 'url', url: 'https://x/y.png' } }] } },
      8,
    );

    expect(() => transcriptToBlocks([sinBase64])).not.toThrow();
    expect(transcriptToBlocks([sinBase64])[0]).toMatchObject({ text: 'mira', attachments: [] });
  });
});

// --- 2.5: subagentes, pensamiento y avisos del CLI al reanudar -------------------------------------

describe('transcriptToBlocks — subagentes, pensamiento y lineas de sistema', () => {
  it('transcriptToBlocks_taskConSuResultado_generaBloqueSubagentConAgentId', () => {
    const blocks = transcriptToBlocks([
      assistantToolUse('tu1', 'Task', { subagent_type: 'Explore', description: 'buscar' }, 0),
      entry(
        'user',
        {
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'listo' }] },
          toolUseResult: { agentId: 'agent-7', status: 'completed' },
        },
        1,
      ),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'subagent',
      agentType: 'Explore',
      description: 'buscar',
      agentId: 'agent-7',
      status: 'completado',
    });
  });

  it('transcriptToBlocks_bloqueThinkingVacio_generaBloqueThinkingSinTexto', () => {
    // MEDIDO: el CLI persiste los bloques `thinking` con texto vacio (solo su firma).
    const raw = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'text', text: 'listo' }] },
    };

    const blocks = transcriptToBlocks([entry('assistant', raw, 3)]);

    expect(blocks[0]).toMatchObject({ kind: 'thinking', runs: [], streaming: false });
    expect(blocks[1]).toMatchObject({ kind: 'agent' });
  });

  it('transcriptToBlocks_lineaSystemCompactBoundary_generaLineaDeSistema', () => {
    // Antes las lineas `system` se tiraban enteras y un /compact DESAPARECIA al reanudar.
    const raw = { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } };

    const blocks = transcriptToBlocks([entry('system', raw, 4)]);

    expect(blocks).toEqual([{ kind: 'system', id: 'tb-4-0', text: 'Contexto compactado (automática)' }]);
  });

  it('transcriptToBlocks_lineaSystemDeOtroSubtype_noEnsuciaElHilo', () => {
    const blocks = transcriptToBlocks([entry('system', { type: 'system', subtype: 'stop_hook_summary' }, 5)]);

    expect(blocks).toEqual([]);
  });

  it('transcriptToBlocks_toolNormal_llevaSuClase', () => {
    const blocks = transcriptToBlocks([assistantToolUse('tu2', 'Read', { file_path: 'a.ts' }, 6)]);

    expect(blocks[0]).toMatchObject({ kind: 'tool', toolClass: 'read', isError: false, diff: null });
  });
});

// El CLI persiste sus bloques `thinking` vacios (medido: solo la firma). Mage guarda el texto aparte y
// lo devuelve al hidratar; el emparejamiento es POR ORDEN, que es lo unico que hay — el CLI no da
// ningun id con el que casarlos.
describe('transcriptToBlocks — pensamientos guardados por Mage', () => {
  const conPensamiento = (index: number): TranscriptEntry =>
    entry('assistant', { message: { content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'text', text: 'hola' }] } }, index);

  it('transcriptToBlocks_conPensamientosGuardados_losPoneEnOrden', () => {
    const blocks = transcriptToBlocks([conPensamiento(0), conPensamiento(1)], ['primero', 'segundo']);
    const pensamientos = blocks.filter((b) => b.kind === 'thinking');

    expect(pensamientos.map((b) => b.runs.map((r) => r.text).join(''))).toEqual(['primero', 'segundo']);
  });

  it('transcriptToBlocks_sinPensamientosGuardados_dejaElBloqueVacioComoAntes', () => {
    // Conversaciones anteriores a que Mage los guardara: el bloque sigue estando (el agente penso), solo
    // que sin cuerpo.
    const blocks = transcriptToBlocks([conPensamiento(0)]);
    const [pensamiento] = blocks.filter((b) => b.kind === 'thinking');

    expect(pensamiento?.runs).toEqual([]);
  });

  it('transcriptToBlocks_conMenosGuardadosQueBloques_rellenaLosPrimeros', () => {
    // Puede pasar de verdad: una conversacion que ya existia y a la que se le añaden turnos nuevos.
    const blocks = transcriptToBlocks([conPensamiento(0), conPensamiento(1)], ['solo uno']);
    const pensamientos = blocks.filter((b) => b.kind === 'thinking');

    expect(pensamientos[0]?.runs.map((r) => r.text).join('')).toBe('solo uno');
    expect(pensamientos[1]?.runs).toEqual([]);
  });
});
