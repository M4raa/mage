import { useEffect, useMemo, useState } from 'react';
import type { ThemedToken } from 'shiki/types';
import { parseMarkdown, type MdBlock, type MdInline } from '../markdown';
import { useHighlightedCode } from '../highlighter';

// Render de Markdown a React (bloques + inline). El parseo vive en el modulo PURO markdown.ts; aqui
// solo se mapea AST -> elementos con los tokens de tema `mg-*`. Todo el texto se rende como texto
// (nunca dangerouslySetInnerHTML): el HTML crudo del modelo se muestra literal. Los contenedores de
// codigo/tablas hacen scroll horizontal propio (no arrastran scroll a toda la ventana).

// Mismo numero y misma razon que `HIGHLIGHT_DEBOUNCE_MS` (highlighter.ts): mientras el bloque esta en
// STREAMING su texto cambia en cada delta, asi que el `useMemo` de abajo —memoizado POR TEXTO— falla
// siempre y reparsea el mensaje ENTERO por delta: coste cuadratico en la longitud del mensaje, y en el
// hilo de UI (auditoria B.2.1). Con la pausa, la rafaga se agrupa y solo se parsea el ultimo texto.
const STREAM_PARSE_DEBOUNCE_MS = 80;

// Texto agrupado mientras dura el streaming. El primer valor NO espera (se pinta desde el primer
// frame); los cambios posteriores se agrupan. Con `streaming=false` devuelve el texto tal cual, sin
// temporizador ninguno: los usos estaticos (un fichero, las instrucciones) no pagan nada.
function useDebouncedText(text: string, streaming: boolean): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (!streaming) return;
    const timer = setTimeout(() => setSettled(text), STREAM_PARSE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, streaming]);
  return streaming ? settled : text;
}

// Punto de entrada: memoiza el parseo por texto (se re-render en cada delta de streaming).
export function Markdown({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }): React.JSX.Element {
  const debounced = useDebouncedText(text, streaming);
  const blocks = useMemo(() => parseMarkdown(debounced), [debounced]);
  return (
    <div className="mg-md flex flex-col gap-[8px] break-words">
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} />
      ))}
    </div>
  );
}

function BlockNode({ block }: { readonly block: MdBlock }): React.JSX.Element {
  switch (block.type) {
    case 'heading':
      return <HeadingNode level={block.level} children={block.children} />;
    case 'paragraph':
      return (
        <p className="leading-[1.6] whitespace-pre-wrap break-words">
          <Inlines nodes={block.children} />
        </p>
      );
    case 'code':
      return <CodeBlock lang={block.lang} text={block.text} />;
    case 'list':
      return <ListNode block={block} />;
    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-mg-border-emph pl-[10px] text-mg-sec">
          <div className="flex flex-col gap-[6px]">
            {block.children.map((b, i) => (
              <BlockNode key={i} block={b} />
            ))}
          </div>
        </blockquote>
      );
    case 'hr':
      return <hr className="my-[2px] border-0 border-t border-mg-border-subtle" />;
    case 'table':
      return <TableNode block={block} />;
  }
}

// Encabezados: tamaño decreciente por nivel. h1/h2 con separador inferior sutil.
function HeadingNode({ level, children }: { readonly level: number; readonly children: readonly MdInline[] }): React.JSX.Element {
  const size = HEADING_SIZE[level] ?? 'text-[13px]';
  const rule = level <= 2 ? 'border-b border-mg-border-subtle pb-[3px]' : '';
  return (
    <div className={`font-semibold text-mg-text ${size} ${rule} mt-[2px] break-words`}>
      <Inlines nodes={children} />
    </div>
  );
}

const HEADING_SIZE: Readonly<Record<number, string>> = {
  1: 'text-[17px]',
  2: 'text-[15px]',
  3: 'text-[14px]',
  4: 'text-[13px]',
  5: 'text-[12.5px]',
  6: 'text-[12px]',
};

// Bloque de codigo: monoespaciado con scroll horizontal propio (no rompe el ancho del chat). El
// resaltado (F4) es ASINCRONO (shiki carga su gramatica en diferido): hasta que llega se pinta el texto
// plano, asi el primer pintado nunca espera al resaltador.
function CodeBlock({ lang, text }: { readonly lang: string | null; readonly text: string }): React.JSX.Element {
  const lines = useHighlightedCode(text, lang);
  return (
    <div className="overflow-hidden rounded-[7px] border border-mg-border-subtle bg-mg-code">
      {lang !== null && (
        <div className="border-b border-mg-border-subtle px-[10px] py-[3px] font-mono text-[10px] text-mg-muted">{lang}</div>
      )}
      <pre className="overflow-x-auto p-[10px] font-mono text-[11.5px] leading-[1.55] text-mg-body">
        <code>{lines === null ? text : <HighlightedLines lines={lines} />}</code>
      </pre>
    </div>
  );
}

// Pinta los tokens de shiki como <span> con color inline. NO se usa el HTML de shiki (`codeToHtml`)
// a proposito: este componente nunca mete HTML crudo en el DOM (misma regla que el resto del render).
// El fondo lo sigue dando el contenedor (bg-mg-code), no el tema de shiki.
// Exportado para que lo reutilice el panel de Ficheros: antes tenia su propia copia de ~15 lineas que
// ademas se dejaba el `fontStyle` (cursiva/negrita) por el camino.
export function HighlightedLines({ lines }: { readonly lines: readonly ThemedToken[][] }): React.JSX.Element {
  return (
    <>
      {lines.map((tokens, line) => (
        <span key={line}>
          {tokens.map((token, i) => (
            <span key={i} style={tokenStyle(token)}>
              {token.content}
            </span>
          ))}
          {line < lines.length - 1 && '\n'}
        </span>
      ))}
    </>
  );
}

// Estilo de un token: color + estilo de fuente. `fontStyle` de shiki es una MASCARA de bits (no un
// string) y vale -1 ("sin fijar") cuando el tema no dice nada, de ahi el `mask > 0`.
export function tokenStyle(token: ThemedToken): React.CSSProperties {
  const style: React.CSSProperties = { color: token.color };
  const mask = token.fontStyle ?? 0;
  if (mask <= 0) return style;
  if ((mask & FONT_STYLE_ITALIC) !== 0) style.fontStyle = 'italic';
  if ((mask & FONT_STYLE_BOLD) !== 0) style.fontWeight = 'bold';
  const decorations: string[] = [];
  if ((mask & FONT_STYLE_UNDERLINE) !== 0) decorations.push('underline');
  if ((mask & FONT_STYLE_STRIKETHROUGH) !== 0) decorations.push('line-through');
  if (decorations.length > 0) style.textDecoration = decorations.join(' ');
  return style;
}

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;
const FONT_STYLE_STRIKETHROUGH = 8;

function ListNode({ block }: { readonly block: Extract<MdBlock, { type: 'list' }> }): React.JSX.Element {
  const className = 'flex flex-col gap-[3px] pl-[20px] ' + (block.ordered ? 'list-decimal' : 'list-disc');
  const items = block.items.map((item, i) => (
    <li key={i} className="leading-[1.55] break-words marker:text-mg-muted">
      {item.children.map((b, j) => (
        <BlockNode key={j} block={b} />
      ))}
    </li>
  ));
  return block.ordered ? (
    <ol start={block.start} className={className}>
      {items}
    </ol>
  ) : (
    <ul className={className}>{items}</ul>
  );
}

// Tabla GFM con scroll horizontal propio (tablas anchas no arrastran scroll global).
function TableNode({ block }: { readonly block: Extract<MdBlock, { type: 'table' }> }): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-[7px] border border-mg-border-subtle">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-mg-tool">
            {block.header.map((cell, i) => (
              <th key={i} className="border border-mg-border-subtle px-[9px] py-[4px] text-left font-semibold text-mg-text">
                <Inlines nodes={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-mg-border-subtle px-[9px] py-[4px] align-top text-mg-body">
                  <Inlines nodes={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Inline -------------------------------------------------------------------------------------

function Inlines({ nodes }: { readonly nodes: readonly MdInline[] }): React.JSX.Element {
  return (
    <>
      {nodes.map((node, i) => (
        <InlineNode key={i} node={node} />
      ))}
    </>
  );
}

function InlineNode({ node }: { readonly node: MdInline }): React.JSX.Element {
  switch (node.type) {
    case 'text':
      return <>{node.text}</>;
    case 'strong':
      return (
        <strong className="font-semibold text-mg-text">
          <Inlines nodes={node.children} />
        </strong>
      );
    case 'em':
      return (
        <em className="italic">
          <Inlines nodes={node.children} />
        </em>
      );
    case 'del':
      return (
        <del className="text-mg-muted line-through">
          <Inlines nodes={node.children} />
        </del>
      );
    case 'code':
      return <code className="rounded-[4px] bg-mg-sel px-[5px] py-px font-mono text-[11.5px] break-words">{node.text}</code>;
    case 'link':
      return (
        <a href={node.href} target="_blank" rel="noreferrer noopener" className="text-mg-focus underline underline-offset-2 hover:opacity-80">
          <Inlines nodes={node.children} />
        </a>
      );
  }
}
