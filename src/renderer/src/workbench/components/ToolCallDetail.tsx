import { extractToolResult, extractToolUses, type ToolResultView, type ToolUseView } from '../toolView';
import { DiffView } from './DiffView';
import type { TranscriptEntry } from '@shared/transcripts';

// Detalle expandido de una fila de transcripcion: si la entrada es una llamada a tool (assistant
// con tool_use) o su resultado (user con tool_result), lo renderiza de forma legible (comando /
// diff / salida) en vez del JSON crudo. Para el resto de entradas, `renderable` es false y la fila
// cae al volcado JSON. Presentacion pura sobre los modulos toolView (derivan de `entry.raw`).

const OUTPUT_MAX_CHARS = 4000; // acota salidas gigantes en el detalle (raw completo sigue en el toggle JSON)

export function toolDetailFor(entry: TranscriptEntry): { readonly toolUses: readonly ToolUseView[]; readonly result: ToolResultView | null } | null {
  const toolUses = extractToolUses(entry);
  const result = extractToolResult(entry);
  if (toolUses.length === 0 && result === null) return null;
  return { toolUses, result };
}

export function ToolCallDetail({ entry }: { readonly entry: TranscriptEntry }): React.JSX.Element | null {
  const detail = toolDetailFor(entry);
  if (detail === null) return null;

  return (
    <div className="flex flex-col gap-[8px]">
      {detail.toolUses.map((use) => (
        <ToolUseCard key={use.toolUseId} use={use} />
      ))}
      {detail.result !== null && <ToolResultCard result={detail.result} />}
    </div>
  );
}

function ToolUseCard({ use }: { readonly use: ToolUseView }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-[6px] border border-mg-border-subtle">
      <div className="flex items-center gap-[6px] bg-mg-hover px-[8px] py-[4px]">
        <span className="font-bold text-mg-body">{use.toolName}</span>
        {use.summary.length > 0 && <span className="truncate text-mg-sec">{use.summary}</span>}
      </div>
    </div>
  );
}

function ToolResultCard({ result }: { readonly result: ToolResultView }): React.JSX.Element {
  return (
    <div className={`overflow-hidden rounded-[6px] border ${result.isError ? 'border-mg-danger-border' : 'border-mg-border-subtle'}`}>
      <div className="flex items-center gap-[6px] bg-mg-hover px-[8px] py-[4px]">
        <span className={result.isError ? 'font-bold text-mg-danger' : 'font-bold text-mg-body'}>
          {result.isError ? 'resultado (error)' : 'resultado'}
        </span>
        {result.filePath !== null && <span className="truncate text-mg-sec">{result.filePath}</span>}
      </div>
      {result.diff !== null && <DiffView lines={result.diff} path={result.filePath} />}
      {result.diff === null && result.writtenContent !== null && <OutputPre text={result.writtenContent} />}
      {result.diff === null && result.writtenContent === null && result.output.length > 0 && <OutputPre text={result.output} />}
    </div>
  );
}



function OutputPre({ text }: { readonly text: string }): React.JSX.Element {
  const clipped = text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n… (${text.length - OUTPUT_MAX_CHARS} car. más)` : text;
  return <pre className="whitespace-pre-wrap break-all bg-mg-code p-[8px] text-[10px] leading-[1.55] text-mg-sec">{clipped}</pre>;
}
