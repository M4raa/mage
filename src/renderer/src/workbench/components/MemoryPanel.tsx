import { useEffect, useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { useMemoryStore } from '../memoryStore';
import type { MemoryNote, MemoryType } from '../memoryView';
import { Hint } from './TranscriptHint';

const TYPE_LABEL: Readonly<Record<MemoryType, string>> = {
  user: 'Usuario',
  project: 'Proyecto',
  feedback: 'Feedback',
  reference: 'Referencia',
  other: 'Otros',
};

// Pestana "Memoria" del Inspector (M2.2.4): muestra los recuerdos del proyecto (frontmatter +
// cuerpo + wikilinks). La memoria es por PROYECTO (cwd), no por sesion, asi que se recarga al
// cambiar de proyecto. PRESENTACION: el parseo vive en el modulo puro memoryView.ts.
export function MemoryPanel(): React.JSX.Element {
  // Config dir efectivo (perfil privado o cuenta) de la pestana activa, para localizar su memoria (M2.6).
  const configDir = useWorkbenchStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId);
    return t === undefined ? undefined : (t.resolvedConfigDir ?? t.accountId);
  });
  const cwd = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.cwd);
  const provider = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.provider);
  const view = useMemoryStore((s) => s.view);
  const isLoading = useMemoryStore((s) => s.isLoading);
  const errorMessage = useMemoryStore((s) => s.errorMessage);
  const load = useMemoryStore((s) => s.load);
  const refresh = useMemoryStore((s) => s.refresh);

  // Fichero del recuerdo abierto en detalle (null = vista de lista).
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (configDir === undefined || cwd === undefined || provider !== 'claude') return;
    setSelected(null); // cambio de proyecto: vuelve a la lista
    void load({ accountDir: configDir, cwd });
  }, [configDir, cwd, provider, load]);

  if (configDir === undefined || cwd === undefined) return <Hint text="Sin conversación activa." />;
  if (provider !== 'claude') return <Hint text={`La memoria de ${provider} se consulta en su CLI.`} />;
  if (errorMessage !== null) return <Hint text={`No se pudo leer la memoria: ${errorMessage}`} onRetry={refresh} />;
  if (view === null) return <Hint text="Cargando memoria…" />;
  if (view.notes.length === 0) {
    return <Hint text={isLoading ? 'Cargando memoria…' : 'Este proyecto no tiene memoria todavía.'} onRetry={refresh} />;
  }

  const current = selected !== null ? (view.notes.find((n) => n.fileName === selected) ?? null) : null;
  if (current !== null) {
    return <MemoryDetail note={current} onBack={() => setSelected(null)} onNavigate={setSelected} />;
  }
  return <MemoryList notes={view.notes} onOpen={setSelected} onRefresh={refresh} />;
}

// --- Vista de lista (agrupada por tipo) ------------------------------------------------------

function MemoryList({
  notes,
  onOpen,
  onRefresh,
}: {
  readonly notes: readonly MemoryNote[];
  readonly onOpen: (fileName: string) => void;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  // Agrupa por tipo respetando el orden ya establecido por buildMemoryView (tipo, luego nombre).
  const groups = useMemo(() => groupByType(notes), [notes]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-mg-border-subtle px-[10px] py-[6px] text-[10px] text-mg-ter">
        <span className="font-bold tracking-[.06em]">MEMORIA ({notes.length})</span>
        <button onClick={onRefresh} data-tip="Releer memoria" className="flex h-4 w-4 items-center justify-center rounded-[4px] text-mg-muted hover:text-mg-body">
          ⟳
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-[10px] py-[8px]">
        {groups.map(({ type, items }) => (
          <div key={type} className="mb-[10px]">
            <div className="mb-[4px] text-[9px] font-bold uppercase tracking-[.08em] text-mg-muted">{TYPE_LABEL[type]}</div>
            <ul className="flex flex-col gap-[3px]">
              {items.map((note) => (
                <li key={note.fileName}>
                  <button
                    onClick={() => onOpen(note.fileName)}
                    className="flex w-full flex-col gap-[1px] rounded-[6px] border border-mg-border-subtle px-[8px] py-[5px] text-left hover:bg-mg-hover"
                    data-tip={note.fileName}
                  >
                    <span className="truncate text-[11px] text-mg-body2">{note.name}</span>
                    {note.description !== null && <span className="line-clamp-2 text-[10px] text-mg-ter">{note.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Vista de detalle -------------------------------------------------------------------------

function MemoryDetail({
  note,
  onBack,
  onNavigate,
}: {
  readonly note: MemoryNote;
  readonly onBack: () => void;
  readonly onNavigate: (fileName: string) => void;
}): React.JSX.Element {
  const linkByRaw = useMemo(() => new Map(note.links.map((l) => [l.raw, l.targetFileName])), [note.links]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-[8px] border-b border-mg-border-subtle px-[10px] py-[6px]">
        <button onClick={onBack} className="shrink-0 rounded-[4px] px-[6px] py-[2px] text-[11px] text-mg-body2 hover:bg-mg-hover" data-tip="Volver a la lista de memoria">
          ◂ Volver
        </button>
        <span className="shrink-0 rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9px] text-mg-body">{TYPE_LABEL[note.type]}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-[12px] py-[10px]">
        <div className="text-[12px] font-bold text-mg-text">{note.name}</div>
        {note.description !== null && <div className="mt-[2px] text-[10.5px] italic text-mg-ter">{note.description}</div>}
        <div className="mt-[10px] whitespace-pre-wrap break-words text-[11px] leading-[1.55] text-mg-body2">
          {renderBodyNodes(note.body, linkByRaw, onNavigate)}
        </div>
      </div>
    </div>
  );
}

const WIKILINK_PATTERN = /\[\[([^\][\n]+)\]\]/g;

// Renderiza el cuerpo con los [[wikilinks]] como botones si resuelven a un recuerdo existente (clic
// -> navega a ese recuerdo); los que no resuelven se muestran como texto atenuado `[[raw]]`.
function renderBodyNodes(
  body: string,
  linkByRaw: ReadonlyMap<string, string | null>,
  onNavigate: (fileName: string) => void,
): readonly React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(<span key={key++}>{body.slice(cursor, start)}</span>);
    const raw = (match[1] ?? '').trim();
    const target = linkByRaw.get(raw) ?? null;
    if (target !== null) {
      nodes.push(
        <button key={key++} onClick={() => onNavigate(target)} className="rounded-[3px] bg-mg-sel px-[3px] text-mg-focus hover:underline">
          {raw}
        </button>,
      );
    } else {
      nodes.push(
        <span key={key++} className="text-mg-muted">
          [[{raw}]]
        </span>,
      );
    }
    cursor = start + match[0].length;
  }
  if (cursor < body.length) nodes.push(<span key={key++}>{body.slice(cursor)}</span>);
  return nodes;
}

interface MemoryGroup {
  readonly type: MemoryType;
  readonly items: readonly MemoryNote[];
}

// Agrupa notas consecutivas por tipo (vienen ya ordenadas por tipo desde buildMemoryView).
function groupByType(notes: readonly MemoryNote[]): readonly MemoryGroup[] {
  const groups: MemoryGroup[] = [];
  for (const note of notes) {
    const last = groups.at(-1);
    if (last !== undefined && last.type === note.type) {
      groups[groups.length - 1] = { type: last.type, items: [...last.items, note] };
    } else {
      groups.push({ type: note.type, items: [note] });
    }
  }
  return groups;
}
