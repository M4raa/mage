import { useState } from 'react';
import type { RowFold } from './SidebarRowItem';

interface RowBranchProps {
  // Pinta la fila con su chevron de plegado.
  readonly head: (fold: RowFold) => React.ReactNode;
  // Las subsesiones ya pintadas (cada una puede ser otra rama).
  readonly kids: readonly React.ReactNode[];
}

// Una conversación con subsesiones: su fila y, debajo, las hijas con sangría y una guía vertical de 1 px. Desplegadas por
// defecto; el plegado que elige el usuario vive aquí y no se persiste.
export function RowBranch({ head, kids }: RowBranchProps): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div data-row-branch="true" className="flex flex-col gap-px">
      {head({ open, onToggle: () => setOpen((current) => !current) })}
      {open && (
        <div data-row-children="true" className="ml-[14px] flex flex-col gap-px border-l border-mg-border-subtle pl-[6px]">
          {kids}
        </div>
      )}
    </div>
  );
}
