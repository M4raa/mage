import { firstSentence } from '../textSummary';

// Fila con cabecera y una descripcion de UNA frase (#34 subagentes declarados, #36 comandos). Si la
// descripcion tiene mas que esa frase, la fila es un boton con `aria-expanded` que la despliega entera;
// si no, hay poco que desplegar y no es pulsable. El estado (un Set de nombres) lo lleva el panel.
export function ExpandableDescriptionRow({
  description,
  expanded,
  onToggle,
  children,
}: {
  readonly description: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const summary = firstSentence(description);
  const expandable = summary !== description.trim();
  const body = (
    <>
      {children}
      {summary.length > 0 && (
        <span className={`block text-[10.5px] leading-[1.4] text-mg-sec2 ${expanded && expandable ? 'whitespace-pre-wrap' : 'truncate'}`}>
          {expanded && expandable ? description : summary}
        </span>
      )}
    </>
  );
  const rowClass = 'flex w-full min-w-0 flex-col gap-[1px] rounded-[6px] p-[4px_6px] text-left hover:bg-mg-hover';
  if (!expandable) return <div className={rowClass}>{body}</div>;
  return (
    <button type="button" aria-expanded={expanded} onClick={onToggle} className={`${rowClass} cursor-pointer`}>
      {body}
    </button>
  );
}

// Alterna un nombre en un Set inmutable (el estado de «desplegado» de un panel).
export function toggleInSet(set: ReadonlySet<string>, name: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(name)) next.add(name);
  return next;
}
