import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { recentProjects, type RecentProject } from '../recentProjects';
import { normalizeFolderKey, recentFolderProjects } from '../sidebarModel';
import { isWindowsPlatform } from '../keybindings/platform';
import { shortenPath } from '../cwdChange';
import { useT } from '../../i18n/uiLanguage';

// Nº de tarjetas (2 filas de 4) y de filas de la lista compacta de debajo (U5, Q-U5).
const RECENT_CARDS_LIMIT = 8;
const RECENT_LIST_LIMIT = 10;

// Tarjetas de proyectos recientes en el estado vacio de una conversacion nueva (P-028, punto 16;
// referencia visual: el selector de conexiones de HuginnDB). Pulsar una fija la carpeta de trabajo
// de ESA pestaña; la confianza en la carpeta se pregunta al primer envio, como siempre.

// Recientes que siguen existiendo en disco. Las carpetas borradas se filtran con una sola consulta a
// main (`existsDirs`); mientras llega la respuesta no se pinta nada, para no enseñar una tarjeta que
// va a desaparecer.
function useExistingRecentProjects(): readonly RecentProject[] {
  const history = useWorkbenchStore((s) => s.conversationHistory);
  const scratchDir = useWorkbenchStore((s) => s.scratchDir);
  const scratchRoots = useWorkbenchStore((s) => s.scratchRoots);
  const ensureScratchDir = useWorkbenchStore((s) => s.ensureScratchDir);
  const candidates = useMemo(
    () => recentProjects({ history, scratchRoot: scratchDir, scratchRoots, limit: RECENT_CARDS_LIMIT, caseInsensitive: isWindowsPlatform() }),
    [history, scratchDir, scratchRoots],
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
  const t = useT();
  const projects = useExistingRecentProjects();
  const allHistory = useWorkbenchStore((s) => s.allConversationHistory);
  const scratchRoots = useWorkbenchStore((s) => s.scratchRoots);
  const folders = useMemo(
    () => recentFolderProjects(allHistory, scratchRoots, new Set(projects.map((p) => normalizeFolderKey(p.cwd))), RECENT_LIST_LIMIT),
    [allHistory, scratchRoots, projects],
  );
  if (projects.length === 0) return null;
  return (
    <div data-recent-projects="true" className="flex w-[min(520px,90%)] flex-col gap-[8px]">
      <div className="text-left text-[9.5px] font-bold tracking-[.1em] text-mg-ter">{t('history.recentProjects.title')}</div>
      <div className="grid grid-cols-4 gap-[8px]">
        {projects.map((project) => (
          <button
            key={project.cwd}
            onClick={() => onPick(project.cwd)}
            aria-pressed={project.cwd === currentCwd}
            data-recent-project={project.cwd}
            title={project.cwd}
            className={`flex min-w-0 flex-col items-start gap-[2px] rounded-[9px] border p-[8px_10px] text-left transition-colors duration-90 ease-out hover:border-mg-focus hover:bg-mg-hover ${
              project.cwd === currentCwd ? 'border-mg-focus bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'border-mg-border-emph'
            }`}
          >
            <span className={`w-full truncate text-[12px] font-semibold ${project.cwd === currentCwd ? 'text-mg-sel-ink' : 'text-mg-text'}`}>{project.name}</span>
            <span className="w-full truncate font-mono text-[10px] text-mg-muted">{shortenPath(project.cwd, 40)}</span>
          </button>
        ))}
      </div>
      {folders.length > 0 && (
        <div data-recent-projects-list="true" className="flex flex-col">
          {folders.map((folder) => (
            <button
              key={folder.cwd}
              onClick={() => onPick(folder.cwd)}
              data-recent-folder={folder.cwd}
              title={folder.cwd}
              className="flex items-center gap-[8px] rounded-[6px] px-[8px] py-[4px] text-left text-[11.5px] text-mg-body transition-colors duration-90 ease-out hover:bg-mg-hover"
            >
              <Icon name="folder" size={12} className="flex-none text-mg-sec" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="flex-none text-mg-muted">{folder.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
