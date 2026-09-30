import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { recentProjects, RECENT_PROJECTS_LIMIT, type RecentProject } from '../recentProjects';
import { isWindowsPlatform } from '../keybindings/platform';
import { shortenPath } from '../cwdChange';

// Tarjetas de proyectos recientes en el estado vacio de una conversacion nueva (P-028, punto 16;
// referencia visual: el selector de conexiones de HuginnDB). Pulsar una fija la carpeta de trabajo
// de ESA pestaña; la confianza en la carpeta se pregunta al primer envio, como siempre.

// Recientes que siguen existiendo en disco. Las carpetas borradas se filtran con una sola consulta a
// main (`existsDirs`); mientras llega la respuesta no se pinta nada, para no enseñar una tarjeta que
// va a desaparecer.
function useExistingRecentProjects(): readonly RecentProject[] {
  const history = useWorkbenchStore((s) => s.conversationHistory);
  const scratchDir = useWorkbenchStore((s) => s.scratchDir);
  const ensureScratchDir = useWorkbenchStore((s) => s.ensureScratchDir);
  const candidates = useMemo(
    () => recentProjects({ history, scratchRoot: scratchDir, limit: RECENT_PROJECTS_LIMIT, caseInsensitive: isWindowsPlatform() }),
    [history, scratchDir],
  );
  const [existing, setExisting] = useState<readonly RecentProject[]>([]);

  // Sin la raiz del scratch, sus carpetas temporales se colarian como "proyectos".
  useEffect(() => void ensureScratchDir(), [ensureScratchDir]);

  useEffect(() => {
    let cancelled = false;
    if (candidates.length === 0) {
      setExisting([]);
      return;
    }
    void window.mage
      .existsDirs(candidates.map((p) => p.cwd))
      .then((exists) => {
        if (!cancelled) setExisting(candidates.filter((_, index) => exists[index] === true));
      })
      .catch((err: unknown) => console.warn('No se pudo comprobar si existen los proyectos recientes:', err));
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  return existing;
}

export function RecentProjects({
  currentCwd,
  onPick,
}: {
  readonly currentCwd: string;
  readonly onPick: (cwd: string) => void;
}): React.JSX.Element | null {
  const projects = useExistingRecentProjects();
  if (projects.length === 0) return null;
  return (
    <div data-recent-projects="true" className="flex w-[min(520px,90%)] flex-col gap-[8px]">
      <div className="text-left text-[9.5px] font-bold tracking-[.1em] text-mg-ter">PROYECTOS RECIENTES</div>
      <div className="grid grid-cols-2 gap-[8px]">
        {projects.map((project) => (
          <button
            key={project.cwd}
            onClick={() => onPick(project.cwd)}
            aria-pressed={project.cwd === currentCwd}
            data-recent-project={project.cwd}
            title={project.cwd}
            className={`flex min-w-0 flex-col items-center gap-[4px] rounded-[9px] border px-[10px] py-[12px] transition-colors duration-150 ease-out hover:border-mg-focus hover:bg-mg-hover ${
              project.cwd === currentCwd ? 'border-mg-focus bg-mg-sel' : 'border-mg-border-emph'
            }`}
          >
            <Icon name="folder" size={16} className="text-mg-sec" />
            <span className="w-full truncate text-[12px] font-semibold text-mg-text">{project.name}</span>
            <span className="w-full truncate font-mono text-[10px] text-mg-muted">{shortenPath(project.cwd, 40)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
