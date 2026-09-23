import { describe, expect, it } from 'vitest';
import { artifactCardFrom, artifactCardsOf } from './artifactView';
import { appendToolUse, applyToolResult } from './engineBlocks';
import type { Block } from './types';

// El `tool_use` y el `tool_result` LITERALES medidos (los mismos que en artifacts.test.ts).
const INPUT = {
  file_path: 'C:\\tmp\\scratchpad\\packaging-informe.html',
  favicon: '📦',
  title: 'Packaging — informe previo',
  description: 'Análisis previo.',
};
const RESULT = 'Published C:\\tmp\\scratchpad\\packaging-informe.html at https://claude.ai/code/artifact/477497ff-717a-4375-a39e-a47e383648a8';

function publishedArtifact(): readonly Block[] {
  const blocks = appendToolUse([], { toolUseId: 'tu1', toolName: 'Artifact', input: INPUT }, 'b1');
  return applyToolResult(blocks, { toolUseId: 'tu1', isError: false, output: RESULT, durationMs: 300 });
}

describe('artifactCardFrom', () => {
  it('artifactCardFrom_bloqueDeArtifact_devuelveLaTarjeta', () => {
    const card = artifactCardFrom(publishedArtifact()[0]!);

    expect(card).toEqual({
      blockId: 'b1',
      url: 'https://claude.ai/code/artifact/477497ff-717a-4375-a39e-a47e383648a8',
      title: 'Packaging — informe previo',
      description: 'Análisis previo.',
      favicon: '📦',
      localPath: INPUT.file_path,
    });
  });

  it('artifactCardFrom_bloqueDeBash_devuelveNull', () => {
    const blocks = appendToolUse([], { toolUseId: 'tu2', toolName: 'Bash', input: { command: 'ls' } }, 'b2');

    expect(artifactCardFrom(blocks[0]!)).toBeNull();
  });

  it('artifactCardFrom_bloqueSinResultadoTodavia_devuelveNull', () => {
    // Mientras la tool corre no hay URL: se pinta la caja normal, no una tarjeta con un boton muerto.
    const blocks = appendToolUse([], { toolUseId: 'tu1', toolName: 'Artifact', input: INPUT }, 'b1');

    expect(artifactCardFrom(blocks[0]!)).toBeNull();
  });

  it('artifactCardFrom_publicacionFallida_devuelveNull', () => {
    const blocks = appendToolUse([], { toolUseId: 'tu1', toolName: 'Artifact', input: INPUT }, 'b1');
    const failed = applyToolResult(blocks, { toolUseId: 'tu1', isError: true, output: 'Publishing failed', durationMs: 10 });

    expect(artifactCardFrom(failed[0]!)).toBeNull();
  });

  it('artifactCardFrom_bloqueQueNoEsTool_devuelveNull', () => {
    expect(artifactCardFrom({ kind: 'user', id: 'u', text: 'hola', time: '', attachments: [] })).toBeNull();
  });
});

// Un artifact publicado, parametrizado, para recorrer TODAS las formas que el usuario puede acabar
// viendo en el panel. Se construye con las mismas funciones que usa el chat en vivo (`appendToolUse` +
// `applyToolResult`), no fabricando bloques a mano: si el emparejado por `toolUseId` se rompiera, estos
// tests tienen que romperse tambien.
function publish(over: Partial<Record<'file_path' | 'favicon' | 'title' | 'description', string>>, url: string, id = 'tu'): readonly Block[] {
  const input = { ...INPUT, ...over };
  const blocks = appendToolUse([], { toolUseId: id, toolName: 'Artifact', input }, `b-${id}`);
  return applyToolResult(blocks, { toolUseId: id, isError: false, output: `Published ${input.file_path} at ${url}`, durationMs: 100 });
}

const URL_A = 'https://claude.ai/code/artifact/aaaaaaaa-1111-2222-3333-444444444444';
const URL_B = 'https://claude.ai/code/artifact/bbbbbbbb-1111-2222-3333-444444444444';

describe('artifactCardFrom — las formas que publica Claude', () => {
  it('artifactCardFrom_paginaMarkdown_seTrataIgualQueUnaHtml', () => {
    // La tool tambien publica `.md` (cuando lo pide una skill). Mage no distingue por extension y no
    // debe: lo que abre es la URL, no el fichero.
    const card = artifactCardFrom(publish({ file_path: 'C:\\tmp\\notas.md', title: 'Notas' }, URL_A)[0]!);

    expect(card?.title).toBe('Notas');
    expect(card?.localPath).toBe('C:\\tmp\\notas.md');
  });

  it('artifactCardFrom_sinTitulo_caeAlNombreDelFichero', () => {
    // En la tarjeta hay que ver ALGO, y la ruta entera del scratchpad no es un titulo.
    const card = artifactCardFrom(publish({ title: '', file_path: 'C:\\tmp\\scratchpad\\informe-final.html' }, URL_A)[0]!);

    expect(card?.title).toBe('informe-final.html');
  });

  it('artifactCardFrom_sinDescripcion_devuelveCadenaVaciaYNoNull', () => {
    // La tarjeta la esconde comparando longitud: un `null` aqui la haria pintar "null".
    const card = artifactCardFrom(publish({ description: '' }, URL_A)[0]!);

    expect(card?.description).toBe('');
  });

  it('artifactCardFrom_faviconDeDosEmoji_seConservaEntero', () => {
    // La tool acepta uno o dos emoji. Recortar a "el primer caracter" partiria un par sustituto.
    const card = artifactCardFrom(publish({ favicon: '⚡🔥' }, URL_A)[0]!);

    expect(card?.favicon).toBe('⚡🔥');
  });

  it('artifactCardFrom_sinFavicon_devuelveVacioYLoResuelveLaTarjeta', () => {
    const card = artifactCardFrom(publish({ favicon: '' }, URL_A)[0]!);

    expect(card?.favicon).toBe('');
  });

  it('artifactCardFrom_resultadoConAvisoDetras_igualSacaLaUrl', () => {
    // Medido: el CLI añade "Warning: The document's own <title> … was not applied" tras la URL.
    const blocks = appendToolUse([], { toolUseId: 'tu', toolName: 'Artifact', input: INPUT }, 'b-tu');
    const done = applyToolResult(blocks, {
      toolUseId: 'tu',
      isError: false,
      output: `Published x at ${URL_A}

Warning: The document's own <title> was not applied`,
      durationMs: 5,
    });

    expect(artifactCardFrom(done[0]!)?.url).toBe(URL_A);
  });

  it('artifactCardFrom_urlDeOtroHost_noDaTarjeta', () => {
    // Frontera de seguridad: una URL de otro host abriria una ventana con la sesion de la cuenta en un
    // sitio ajeno. Sin tarjeta no hay boton que la abra.
    const card = artifactCardFrom(publish({}, 'https://evil.example/?x=https://claude.ai/code/artifact/1')[0]!);

    expect(card).toBeNull();
  });
});

describe('artifactCardsOf', () => {
  it('artifactCardsOf_hiloConVarios_losDevuelveEnOrden', () => {
    const blocks = [...publish({ title: 'Primero' }, URL_A, 't1'), ...publish({ title: 'Segundo' }, URL_B, 't2')];

    expect(artifactCardsOf(blocks).map((c) => c.title)).toEqual(['Primero', 'Segundo']);
  });

  it('artifactCardsOf_mismaUrlDosVeces_apareceUnaSolaYGanaLaUltima', () => {
    // Republicar deja DOS llamadas a la tool con la misma URL. En una lista eso seria la misma pagina
    // dos veces, y el titulo bueno es el ultimo.
    const blocks = [...publish({ title: 'Borrador' }, URL_A, 't1'), ...publish({ title: 'Definitivo' }, URL_A, 't2')];

    const cards = artifactCardsOf(blocks);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe('Definitivo');
  });

  it('artifactCardsOf_hiloSinArtifacts_devuelveVacio', () => {
    const blocks = appendToolUse([], { toolUseId: 'x', toolName: 'Bash', input: { command: 'ls' } }, 'bx');

    expect(artifactCardsOf(blocks)).toEqual([]);
  });

  it('artifactCardsOf_conUnoAunPublicandose_soloCuentaLosYaPublicados', () => {
    const enCurso = appendToolUse([], { toolUseId: 'z', toolName: 'Artifact', input: INPUT }, 'bz');

    expect(artifactCardsOf([...publish({}, URL_A, 't1'), ...enCurso])).toHaveLength(1);
  });
});
