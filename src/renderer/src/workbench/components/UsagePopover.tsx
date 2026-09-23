import { useWorkbenchStore } from '../workbenchStore';

// Popover con el uso de TODAS las cuentas. Se ancla SOLO desde el resumen de la status bar (hover/
// foco) — feedback del usuario (2026-08-06): antes se duplicaba tambien en el pie del sidebar, quitado
// porque el panel "Uso" del dock ya cubre esa funcion. El posicionamiento lo pone el contenedor; aqui
// solo el contenido.
export function UsagePopover(): React.JSX.Element {
  const accounts = useWorkbenchStore((s) => s.accounts);

  return (
    <div className="flex w-[228px] flex-col gap-2 rounded-[9px] border border-mg-border-pop bg-mg-popover p-[11px_12px] text-[10.5px] mg-shadow-pop">
      <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">
        USO — TODAS LAS CUENTAS <span className="font-normal text-mg-muted">(al pasar el ratón)</span>
      </div>
      {accounts.map((a) => (
        <div key={a.id} className="flex flex-col gap-[3px]">
          <div className="flex justify-between text-mg-body2">
            <span className="flex items-center gap-[6px]">
              <span className="h-[6px] w-[6px] rounded-[2px]" style={{ background: a.accent.base }} />
              {a.alias} · {a.provider}
            </span>
            <span className="text-mg-text">
              5h {a.usage.fiveHour.pct}% · sem {a.usage.weekly.pct}%
            </span>
          </div>
          <div className="h-[3px] rounded-[2px] bg-mg-border-emph">
            <div
              className="h-full rounded-[2px]"
              style={{ width: `${a.usage.fiveHour.pct}%`, background: a.accent.base }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
