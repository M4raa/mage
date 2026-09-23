import type { RowComponentProps } from 'react-window';
import type { TranscriptEntry } from '@shared/transcripts';

export interface TranscriptRowProps {
  readonly entries: readonly TranscriptEntry[];
  readonly selectedIndex: number | null;
  readonly onSelect: (index: number) => void;
}

// Fila individual de la lista virtualizada (react-window exige un componente funcion plano como
// `rowComponent`; envolverlo en React.memo cambia el tipo de retorno a ReactNode y no encaja con la
// firma que react-window espera).
//
// La fila SELECCIONA; no despliega. El detalle se pinta debajo de la lista, en su propia seccion —ver
// TranscriptLogPanel—. Antes se dibujaba como un overlay `absolute` dentro de la propia fila, para no
// romper el calculo de alturas de la lista virtualizada (que las exige fijas), y esa era la trampa: las
// filas de react-window son hermanas ABSOLUTAS, asi que el overlay de la fila N acababa entremezclado
// con el texto de las filas N+1 y N+2 en vez de taparlas. El usuario lo reporto con dos capturas, y no
// tenia arreglo con un z-index: el sitio del detalle no era ese.
export function TranscriptRow({
  index,
  style,
  entries,
  selectedIndex,
  onSelect,
}: RowComponentProps<TranscriptRowProps>): React.JSX.Element {
  const entry = entries[index];
  if (entry === undefined) return <div style={style} />;

  const selected = selectedIndex === index;
  return (
    <div style={style} className="border-b border-mg-border-subtle px-[10px] font-mono text-[10.5px]">
      <button
        onClick={() => onSelect(index)}
        aria-pressed={selected}
        className={`flex h-full w-full items-center gap-[8px] truncate text-left ${
          selected ? 'text-mg-text' : 'text-mg-body2 hover:text-mg-text'
        }`}
      >
        <span className="shrink-0 text-mg-ter">{entry.index + 1}</span>
        <span className={`shrink-0 rounded-[4px] px-[5px] py-[1px] text-[9px] ${categoryBadgeClass(entry.category)}`}>
          {entry.kind}
        </span>
        <span className="truncate">{entry.summary}</span>
      </button>
    </div>
  );
}

function categoryBadgeClass(category: TranscriptEntry['category']): string {
  if (category === 'turn') return 'bg-mg-sel text-mg-body';
  if (category === 'metadata') return 'bg-mg-hover text-mg-ter';
  return 'bg-mg-danger-bg text-mg-danger'; // unknown: destaca tipos no catalogados
}
