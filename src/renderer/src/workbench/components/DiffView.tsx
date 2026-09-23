import { useMemo } from 'react';
import type { ThemedToken } from 'shiki/types';
import { langFromPath } from '../codeHighlight';
import { useHighlightedCode } from '../highlighter';
import { tokenStyle } from './Markdown';
import type { DiffLine } from '../diffLines';

// El UNICO visor de diff de Mage (2.12.2). Antes habia dos, con dos paletas distintas: el `FilePreview`
// del chat (que ni siquiera sabia que era un diff: coloreaba por el primer caracter del texto) y el
// `DiffView` del detalle de una tool en el panel de Logs.
//
// Novedad: DOS COLUMNAS DE NUMEROS (antigua/nueva), alineadas en monoespaciado. Una linea sin numero en
// un lado —una adicion no existe en el fichero viejo— deja su hueco vacio en vez de repetir el numero
// de al lado, que es lo que hace que el diff se pueda leer de un vistazo.
//
// Novedad del 2026-09-18 (peticion del usuario, "como claude code"): FONDO por linea (verde/rojo) y
// RESALTADO DE SINTAXIS del codigo. El fondo es lo que distingue insercion de borrado sin leer el
// signo; el resaltado usa el mismo shiki que el chat, con el lenguaje deducido de `path` — sin `path`
// (o con una extension sin gramatica) el diff se pinta igual, solo que en texto plano.
const MAX_HEIGHT_PX = 260;

export function DiffView({ lines, path = null }: { readonly lines: readonly DiffLine[]; readonly path?: string | null }): React.JSX.Element {
  // Si NINGUNA linea trae numero (un diff derivado del input de la tool, o hunks sin `oldStart`), las
  // columnas no se pintan: mejor sin numeros que con numeros inventados.
  const numbered = lines.some((line) => line.oldLine !== null || line.newLine !== null);
  const highlighted = useDiffTokens(lines, path);
  return (
    <div
      // `data-diff` es el ancla del harness: sin ella, medir "la fila del borrado" acaba casando con el
      // contenedor entero, que tambien contiene ese texto.
      data-diff="lines"
      style={{ maxHeight: MAX_HEIGHT_PX }}
      className="overflow-auto border-t border-mg-border-subtle bg-mg-code p-[8px_0] font-mono text-[11px] leading-[1.6]"
    >
      {lines.map((line, index) => (
        <div key={index} className={`flex ${lineClass(line.sign)}`}>
          {numbered && (
            <>
              <LineNumber value={line.oldLine} />
              <LineNumber value={line.newLine} />
            </>
          )}
          <span className="w-[14px] flex-none select-none text-center opacity-70">{line.sign === ' ' ? '' : line.sign}</span>
          <span className="whitespace-pre-wrap break-all pr-[12px]">
            <LineText text={line.text} tokens={highlighted?.[index] ?? null} />
          </span>
        </div>
      ))}
    </div>
  );
}

// Tokens de shiki de CADA linea del diff. Se resalta el cuerpo entero de una vez (las lineas unidas por
// `\n`, ya sin los signos): asi el resaltador ve el fichero como codigo continuo —una funcion abierta en
// una linea sigue abierta en la siguiente— y devuelve una entrada por linea, alineada por indice con
// `lines`. `null` mientras no hay tokens o si el resaltado no aplica: entonces se pinta el texto plano.
function useDiffTokens(lines: readonly DiffLine[], path: string | null): readonly (readonly ThemedToken[])[] | null {
  const code = useMemo(() => lines.map((line) => line.text).join('\n'), [lines]);
  const tokens = useHighlightedCode(code, langFromPath(path));
  // Guarda barata frente a un desfase: si el resaltador devolvio otro numero de lineas (texto viejo aun
  // en vuelo tras cambiar el diff), se cae a texto plano en vez de pintar colores de otras lineas.
  return tokens !== null && tokens.length === lines.length ? tokens : null;
}

function LineText({ text, tokens }: { readonly text: string; readonly tokens: readonly ThemedToken[] | null }): React.JSX.Element {
  if (tokens === null || tokens.length === 0) return <>{text.length > 0 ? text : ' '}</>;
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </>
  );
}

function LineNumber({ value }: { readonly value: number | null }): React.JSX.Element {
  return (
    <span className="w-[38px] flex-none select-none pr-[8px] text-right text-mg-muted opacity-60">
      {value === null ? '' : value}
    </span>
  );
}

// Solo tokens del tema: asi conmuta igual en claro, oscuro y en un tema importado de Open VSX. El COLOR
// DE TEXTO solo lo fija el contexto —las lineas con signo lo reciben del resaltador, y el suyo propio
// cuando no hay resaltado—; lo que siempre manda es el FONDO.
function lineClass(sign: DiffLine['sign']): string {
  if (sign === '+') return 'bg-mg-diff-add-bg text-mg-diff-add';
  if (sign === '-') return 'bg-mg-diff-del-bg text-mg-diff-del';
  return 'text-mg-sec';
}
