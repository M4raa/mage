import { useEffect, useMemo } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { folderChip, modelChip, privacyChip, type ChatChip } from '../chatInfoView';
import { modelLabel } from '../models';

// Fila de informacion del chat, encima del input (peticion del usuario).
//
// La alternativa que se pidio primero era la "status line" del CLI, pero esa es una linea que el
// usuario CONFIGURA con un comando propio y que el CLI ejecuta: traerla aqui significaria lanzar
// procesos por cada refresco para pintar texto. El propio usuario ofrecio la salida — "o si es muy feo
// como queda, deberian salir etiquetas de informacion del chat" — y eso es esto: lo que de verdad hace
// falta ver de un vistazo, sin ejecutar nada.
//
// La carpeta es la unica etiqueta ACCIONABLE, y es la que se pidio por su nombre: al pulsarla se abre,
// que es como se llega a los ficheros que va generando el agente y al scratchpad. Las demas informan.
export function ChatInfoBar(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const resolvedModel = useWorkbenchStore((s) => s.resolvedModelByChat[tabId] ?? null);
  const scratchDir = useWorkbenchStore((s) => s.scratchDir);
  const ensureScratchDir = useWorkbenchStore((s) => s.ensureScratchDir);
  const customProviders = useWorkbenchStore((s) => s.settings.customProviders);

  useEffect(() => {
    void ensureScratchDir();
  }, [ensureScratchDir]);

  const chips = useMemo((): readonly ChatChip[] => {
    if (tab === undefined) return [];
    const folder = folderChip(tab.cwd, scratchDir);
    return [
      ...(folder === null ? [] : [folder]),
      privacyChip(tab.privacy),
      modelChip(modelLabel(tab.provider, tab.model, customProviders), resolvedModel),
    ];
  }, [tab, scratchDir, resolvedModel, customProviders]);

  // Sin pestaña no hay nada que contar, y una fila vacia solo roba alto al hilo.
  if (tab === undefined || chips.length === 0) return null;
  const [folder, ...rest] = chips;

  return (
    <div className="flex flex-wrap items-center gap-[6px] px-[22px] pt-[8px] text-[10.5px] text-mg-muted">
      <button
        onClick={() => void window.mage.openPath(tab.cwd).catch(() => undefined)}
        data-tip={folder!.title}
        aria-label={folder!.title}
        className="inline-flex max-w-[280px] items-center gap-[5px] rounded-full border border-mg-border-ctrl px-[8px] py-[2px] transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
      >
        <Icon name={folder!.icon} size={12} />
        <span className="truncate">{folder!.label}</span>
      </button>
      {rest.map((chip) => (
        // Las informativas NO son botones: nada ocurre al pulsarlas, y un boton que no hace nada es una
        // promesa rota. El dato largo va en el tooltip y en el nombre accesible.
        <span
          key={chip.label}
          data-tip={chip.title}
          aria-label={chip.title}
          className="inline-flex max-w-[280px] cursor-help items-center gap-[5px] rounded-full border border-mg-border-subtle px-[8px] py-[2px]"
        >
          <Icon name={chip.icon} size={12} />
          <span className="truncate">{chip.label}</span>
        </span>
      ))}
    </div>
  );
}
