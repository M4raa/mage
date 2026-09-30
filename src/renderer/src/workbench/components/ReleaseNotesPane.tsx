import { useWorkbenchStore } from '../workbenchStore';
import { pickReleaseNotesEntry, RELEASE_NOTES_TAB_ID } from '../releaseNotes';
import { CHANGELOG_ENTRIES } from '../releaseNotesContent';
import { Markdown } from './Markdown';

// Panel de la pseudo-pestaña de novedades: ocupa el sitio de un `ChatPane`, pero sin prompt (no es una
// conversacion). A la izquierda, todas las versiones del changelog; a la derecha, las notas de la elegida,
// que al abrirse es la instalada. Va en diferido desde App.tsx: el changelog no viaja en el arranque.
export function ReleaseNotesPane({ focused, split }: { readonly focused: boolean; readonly split: boolean }): React.JSX.Element {
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const openReleaseNotes = useWorkbenchStore((s) => s.openReleaseNotes);
  const requested = useWorkbenchStore((s) => s.releaseNotesVersion);
  const installed = useWorkbenchStore((s) => s.appVersion);
  const entry = pickReleaseNotesEntry(CHANGELOG_ENTRIES, requested, installed);
  // Mismo contrato que `ChatPane`: interactuar con el panel lo enfoca, y el panel enfocado es `activeTabId`.
  const take = (): void => {
    if (!focused) setActiveTab(RELEASE_NOTES_TAB_ID);
  };

  return (
    <div
      data-release-notes
      onMouseDownCapture={take}
      onFocusCapture={take}
      className={`relative flex min-h-0 min-w-0 flex-1 bg-mg-window ${
        split ? (focused ? 'outline outline-1 -outline-offset-1 outline-mg-border-emph' : 'opacity-80') : ''
      }`}
    >
      <nav aria-label="Versiones de Mage" className="flex w-[168px] shrink-0 flex-col gap-[1px] overflow-y-auto border-r border-mg-border p-[12px]">
        <div className="mb-[6px] px-[10px] text-[9.5px] font-bold tracking-[.1em] text-mg-ter">VERSIONES</div>
        {CHANGELOG_ENTRIES.map((candidate) => {
          const current = candidate.version === entry?.version;
          return (
            <button
              key={candidate.version}
              aria-current={current ? 'page' : undefined}
              onClick={() => openReleaseNotes(candidate.version)}
              className={`flex items-baseline justify-between gap-[6px] rounded-[7px] px-[10px] py-[6px] text-left text-[11.5px] transition-colors duration-150 ease-out ${
                current ? 'bg-mg-sel text-mg-body' : 'text-mg-body2 hover:bg-mg-hover'
              }`}
            >
              <span className="font-mono">{candidate.version}</span>
              {candidate.version === installed && <span className="text-[9.5px] text-mg-ter">instalada</span>}
            </button>
          );
        })}
      </nav>
      {/* `key` por version: cambiar de version remonta el articulo y su scroll vuelve arriba. */}
      <article key={entry?.version ?? ''} aria-labelledby="release-notes-title" className="min-w-0 flex-1 overflow-y-auto p-[20px_28px]">
        {entry === null ? (
          <p className="text-[12px] text-mg-sec">No hay notas de versión.</p>
        ) : (
          <div className="max-w-[760px]">
            <h2 id="release-notes-title" className="text-[16px] font-semibold text-mg-text">
              Mage {entry.version}
            </h2>
            {entry.label.length > 0 && <div className="mt-[2px] text-[11px] text-mg-ter">{entry.label}</div>}
            <div className="mt-[14px] text-[12.5px] leading-[1.6] text-mg-body">
              <Markdown text={entry.body} />
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
