// Linea-resumen de una racha de herramientas (2.12.2): `▸ Leídos 2 ficheros, 1 búsqueda`.
//
// Es el equivalente del "Searched for 3 patterns, read 2 files" de Claude Code, y su razon de ser es
// que un turno con quince lecturas seguidas no empuje la respuesta fuera de la pantalla. Al desplegarla
// salen las cajas de dentro, CADA UNA COLAPSADA: dos niveles, como decidio el usuario.
//
// Lo que NUNCA entra en una racha (y por eso no hace falta mirarlo aqui: lo decide `toolGrouping`):
// una tool con error, una que sigue corriendo y el pensamiento que se esta escribiendo.
export function ToolRunRow({
  summary,
  expanded,
  onToggle,
  children,
}: {
  readonly summary: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[6px]">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-fit items-center gap-[7px] rounded-[7px] px-[8px] py-[3px] text-[11px] text-mg-ter hover:bg-mg-hover hover:text-mg-body2"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span>{summary}</span>
      </button>
      {expanded && <div className="flex flex-col gap-[8px] border-l border-mg-border-subtle pl-[10px]">{children}</div>}
    </div>
  );
}
