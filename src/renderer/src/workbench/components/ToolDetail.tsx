import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { HighlightedLines } from './Markdown';
import { DiffView } from './DiffView';
import { useHighlightedCode } from '../highlighter';
import { langFromPath } from '../codeHighlight';
import type { Block } from '../types';

// Cuerpos de una herramienta ya ejecutada: salida, diff, contenido escrito y acciones sobre el fichero.
// Salieron de `BlockChat` (P-026 3.4) para que los use el panel de Actividad, que es donde se ven ahora.

// Todo lo que una herramienta tiene que enseñar, en el orden de siempre.
export function ToolBody({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[6px]">
      {block.output.length > 0 && <ToolOutput block={block} />}
      {block.diff !== null && <DiffView lines={block.diff} path={block.filePath} />}
      {block.diff === null && block.writtenContent !== null && <WrittenContent lines={block.writtenContent} path={block.filePath} />}
      {block.filePath !== null && <FileActions path={block.filePath} />}
    </div>
  );
}

// Salida de una tool. Cuando lo que trae es el CONTENIDO DE UN FICHERO (una lectura con ruta conocida)
// se resalta con el mismo shiki que el chat: leer 200 lineas de codigo en gris plano era lo que pedia
// arreglar el usuario. Para todo lo demas —stdout de un Bash, confirmaciones— el texto plano es lo
// correcto: no hay lenguaje que aplicar.
export function ToolOutput({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  const text = block.output.map((run) => run.text).join('');
  const lang = block.toolClass === 'read' ? langFromPath(block.filePath) : null;
  const lines = useHighlightedCode(text, lang);
  return (
    <div className="whitespace-pre-wrap bg-mg-code p-[9px_14px] font-mono text-[11px] leading-[1.65] text-mg-sec">
      {lines === null ? text : <HighlightedLines lines={lines} />}
    </div>
  );
}

// Contenido completo de un fichero recien CREADO (un `Write`): no hay diff que enseñar porque no habia
// nada antes, asi que se pinta el contenido sin signos ni numeros de linea antiguos — pero SI con
// resaltado, que es lo que lo hace legible.
export function WrittenContent({ lines, path }: { readonly lines: readonly string[]; readonly path: string | null }): React.JSX.Element {
  const text = useMemo(() => lines.join('\n'), [lines]);
  const highlighted = useHighlightedCode(text, langFromPath(path));
  return (
    <div className="max-h-[260px] overflow-auto whitespace-pre-wrap border-t border-mg-border-subtle bg-mg-code p-[9px_14px] font-mono text-[11px] leading-[1.6] text-mg-sec">
      {highlighted === null ? text : <HighlightedLines lines={highlighted} />}
    </div>
  );
}



// Botones para abrir la ubicacion del archivo en el gestor del SO y guardarlo (copiar) fuera.
export function FileActions({ path }: { readonly path: string }): React.JSX.Element {
  const [saved, setSaved] = useState(false);

  const reveal = (): void => {
    void window.mage.revealFile(path).catch((err: unknown) => console.error('No se pudo abrir la ubicación', err));
  };
  const save = (): void => {
    void window.mage
      .saveFileAs(path)
      .then((ok) => setSaved(ok))
      .catch((err: unknown) => console.error('No se pudo guardar el archivo', err));
  };

  return (
    <div className="flex items-center gap-[8px] border-t border-mg-border-subtle p-[8px_14px] text-[11px]">
      <button
        onClick={reveal}
        className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[4px] text-mg-body2 hover:bg-mg-hover"
      >
        <Icon name="folderOpen" size={12} /> Abrir ubicación
      </button>
      <button
        onClick={save}
        className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[4px] text-mg-body2 hover:bg-mg-hover"
      >
        <Icon name="save" size={12} /> Guardar como…
      </button>
      {saved && <span className="text-mg-ter">✓ guardado</span>}
      <span className="ml-auto truncate font-mono text-[10px] text-mg-muted">{path}</span>
    </div>
  );
}
