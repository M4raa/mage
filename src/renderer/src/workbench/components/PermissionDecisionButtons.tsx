import { useWorkbenchStore } from '../workbenchStore';

// Las TRES decisiones de un permiso, en un solo sitio (2.3b). Las pintan la tarjeta del chat
// (PermissionCard) y el panel de Permisos, y son la misma cosa: el mismo can_use_tool, los mismos
// atajos anunciados y la misma semantica. Con el bloque duplicado en los dos ficheros, "permitir
// siempre" ya habia divergido una vez.
//
// `aria-label` ESTABLE y separado del contenido: sin el, el nombre accesible sale del texto visible y
// se cuela el numero del atajo ("Permitir1"), que un lector de pantalla lee tal cual y que no hay
// manera de anclar desde fuera (costo varias tandas de verificacion creyendo que el boton no estaba).

export function PermissionDecisionButtons({
  toolLabel,
  compact = false,
}: {
  readonly toolLabel: string;
  // En la tarjeta del chat los botones van en FILA y sin el numero del atajo: es una tarjeta dentro del
  // hilo, no el contenido de un panel, y ahi el ancho es el recurso escaso.
  readonly compact?: boolean;
}): React.JSX.Element {
  const answer = useWorkbenchStore((s) => s.answerActivePermission);
  const allowAlways = useWorkbenchStore((s) => s.allowAlwaysAndAnswer);
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-[6px] text-[11.5px]' : 'flex flex-col gap-[6px] text-[12px]'}>
      <Option shortcut="1" label="Permitir" primary compact={compact} onClick={() => answer({ behavior: 'allow' })}>
        Permitir
      </Option>
      {/* "Permitir siempre" SI recuerda (2.3b): guarda una regla por conversacion en el indice de Mage y
          los siguientes can_use_tool de esa tool se auto-aprueban. Se lista y se revoca en el panel. */}
      <Option
        shortcut="2"
        label={`Permitir siempre ${toolLabel} aquí`}
        compact={compact}
        onClick={() => allowAlways(toolLabel)}
      >
        Permitir siempre <span className="font-mono text-[11px]">{toolLabel}</span> aquí
      </Option>
      <Option
        shortcut="3"
        label="Denegar y decir por qué"
        compact={compact}
        onClick={() => answer({ behavior: 'deny', message: 'Denegado por el usuario' })}
      >
        Denegar
      </Option>
    </div>
  );
}

function Option({
  shortcut,
  label,
  primary = false,
  compact,
  onClick,
  children,
}: {
  readonly shortcut: string;
  readonly label: string;
  readonly primary?: boolean;
  readonly compact: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const base = compact
    ? 'flex items-center rounded-[7px] px-[10px] py-[4px]'
    : 'flex items-center justify-between rounded-[7px] p-[8px_12px]';
  const skin = primary
    ? 'bg-mg-primary font-semibold text-mg-primary-ink'
    : 'border border-mg-border-emph text-mg-body2 hover:bg-mg-hover';
  return (
    <button onClick={onClick} aria-label={label} aria-keyshortcuts={shortcut} className={`${base} ${skin}`}>
      <span>{children}</span>
      {!compact && (
        <span aria-hidden="true" className="font-mono text-[10.5px] opacity-50">
          {shortcut}
        </span>
      )}
    </button>
  );
}
