// Aviso de una linea con boton opcional de reintento. Compartido por el panel de Logs y el overlay
// de drill-down de subagentes (estados carga/vacio/error), para no duplicar el mismo marcado.
export function Hint({ text, onRetry }: { readonly text: string; readonly onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-[8px] p-[14px] text-[11px] text-mg-muted">
      <span>{text}</span>
      {onRetry !== undefined && (
        <button onClick={onRetry} className="rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">
          ⟳ Reintentar
        </button>
      )}
    </div>
  );
}
