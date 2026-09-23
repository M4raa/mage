import { useWorkbenchStore } from '../workbenchStore';
import type { Block } from '../types';

// Bloque de PENSAMIENTO plegable (2.5): `▸ Pensó`, y al abrirlo el texto.
//
// El CLI persiste sus bloques `thinking` con `"thinking": ""` — solo la firma, MEDIDO. Antes eso
// significaba que al reanudar quedaba el "▸ Pensó" sin cuerpo, y el bloque lo explicaba. Ya no: Mage
// guarda el texto por su cuenta segun llega en vivo (`main/state/thinkingStore.ts`) y lo devuelve al
// hidratar, que es lo que pidio el usuario — «es Mage quien debería guardar lo que no guarda el CLI».
//
// El hueco sin texto solo queda para las conversaciones ANTERIORES a eso, y ahi el mensaje lo dice sin
// echarle la culpa a nadie: ese pensamiento no se llego a guardar y no esta en ningun sitio.
export function ThinkingBlock({ block }: { readonly block: Extract<Block, { kind: 'thinking' }> }): React.JSX.Element {
  const expanded = useWorkbenchStore((s) => s.expandedTools.has(block.id));
  const toggleTool = useWorkbenchStore((s) => s.toggleTool);
  const text = block.runs.map((run) => run.text).join('');

  return (
    <div className="flex flex-col gap-[5px]">
      <button
        onClick={() => toggleTool(block.id)}
        aria-expanded={expanded}
        className="flex w-fit items-center gap-[7px] rounded-[7px] px-[8px] py-[3px] text-[11px] italic text-mg-ter hover:bg-mg-hover"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span>{block.streaming ? 'Pensando…' : 'Pensó'}</span>
        {block.elapsedMs !== null && <span className="not-italic opacity-70">({formatElapsed(block.elapsedMs)})</span>}
      </button>
      {expanded && (
        <div className="ml-[10px] whitespace-pre-wrap break-words border-l border-mg-border-subtle pl-[10px] text-[11.5px] leading-[1.55] text-mg-muted">
          {text.length > 0 ? text : 'Este pensamiento no se guardó: es de antes de que Mage empezara a conservarlos.'}
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}
