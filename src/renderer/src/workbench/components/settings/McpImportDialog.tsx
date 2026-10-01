import { useEffect, useMemo, useState } from 'react';
import type { McpImportCandidate, McpImportGroup, McpImportPreview, McpImportStatus } from '@shared/mcp';
import { useMcpStore } from '../../mcpStore';
import { MCP_BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';

// «Importar…» con vista previa (P-028 punto 34). Origen elegible: Claude Desktop, Claude Code CLI o los
// dos. Cada fila dice si es nueva, si ya esta igual o si existe con otra configuracion (en ese caso se
// queda la actual salvo que se marque «sustituir»). El original nunca se toca. El renderer solo ve
// nombres y metadatos: al aplicar manda ids y main relee las fuentes.

type GroupFilter = 'all' | McpImportGroup;

const FILTERS: readonly { readonly id: GroupFilter; readonly label: string }[] = [
  { id: 'all', label: 'Los dos' },
  { id: 'desktop', label: 'Claude Desktop' },
  { id: 'cli', label: 'Claude Code CLI' },
];
const STATUS_LABELS: Readonly<Record<McpImportStatus, string>> = { new: 'Nuevo', same: 'Ya está igual', different: 'Existe con otra config' };

interface Selection {
  readonly checked: ReadonlySet<string>;
  readonly replace: ReadonlySet<string>;
}

const initialSelection = (candidates: readonly McpImportCandidate[]): Selection => ({
  checked: new Set(candidates.filter((c) => c.checkedByDefault).map((c) => c.id)),
  replace: new Set(),
});

const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

// Una fila se puede marcar si no esta bloqueada y aporta algo (igual = nada que importar).
const isSelectable = (candidate: McpImportCandidate): boolean => candidate.status !== 'same';

export function McpImportDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const previewImport = useMcpStore((s) => s.previewImport);
  const applyImport = useMcpStore((s) => s.applyImport);
  const [preview, setPreview] = useState<McpImportPreview | null>(null);
  const [selection, setSelection] = useState<Selection>({ checked: new Set(), replace: new Set() });
  const [filter, setFilter] = useState<GroupFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<readonly string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    previewImport()
      .then((result) => {
        setPreview(result);
        setSelection(initialSelection(result.candidates));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const visible = useMemo(() => (preview?.candidates ?? []).filter((c) => filter === 'all' || c.group === filter), [preview, filter]);
  const picks = visible.filter((c) => isSelectable(c) && selection.checked.has(c.id)).map((c) => ({ id: c.id, replace: selection.replace.has(c.id) }));

  const apply = (): void => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    applyImport(picks, preview.commonVersion)
      .then((result) => (result.status === 'saved' ? setNotes(result.notes) : setError(result.message)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-import-title"
        data-mcp-import-dialog="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={stopEscape(onClose)}
        className={MCP_DIALOG_PANEL_CLASS}
      >
        <div id="mcp-import-title" className="text-[12.5px] font-bold text-mg-text">
          Importar servidores MCP a los comunes
        </div>
        <p className="text-[10.5px] leading-[1.5] text-mg-sec">
          Se copian a <code>mcp-common.json</code> y los verán todas tus cuentas. El original no se toca.
        </p>
        {notes !== null ? (
          <ImportDone notes={notes} count={picks.length} onClose={onClose} />
        ) : (
          <>
            <div role="radiogroup" aria-label="Origen" className="flex gap-[4px]">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={`rounded-[6px] border px-[9px] py-[3px] text-[10.5px] ${filter === option.id ? 'border-mg-focus bg-mg-sel text-mg-body' : 'border-mg-border-subtle text-mg-body2 hover:bg-mg-hover'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {preview === null && error === null && <p className="text-[11px] text-mg-muted">Leyendo las fuentes…</p>}
            {preview !== null && visible.length === 0 && <p className="text-[11px] text-mg-muted">No hay nada que importar de este origen.</p>}
            <ul className="flex flex-col gap-[4px]">
              {visible.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  checked={selection.checked.has(candidate.id)}
                  replace={selection.replace.has(candidate.id)}
                  onToggle={() => setSelection((s) => ({ ...s, checked: toggle(s.checked, candidate.id) }))}
                  onToggleReplace={() => setSelection((s) => ({ ...s, replace: toggle(s.replace, candidate.id) }))}
                />
              ))}
            </ul>
            {error !== null && (
              <div role="alert" className="text-[10.5px] text-mg-danger">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-[8px]">
              <button onClick={onClose} className={MCP_BUTTON_CLASS}>
                Cancelar
              </button>
              <button onClick={apply} disabled={busy || picks.length === 0} className={MCP_PRIMARY_BUTTON_CLASS}>
                {busy ? 'Importando…' : `Importar ${picks.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  checked,
  replace,
  onToggle,
  onToggleReplace,
}: {
  readonly candidate: McpImportCandidate;
  readonly checked: boolean;
  readonly replace: boolean;
  readonly onToggle: () => void;
  readonly onToggleReplace: () => void;
}): React.JSX.Element {
  const selectable = isSelectable(candidate);
  return (
    <li data-mcp-candidate={candidate.name} className="flex flex-col gap-[2px] rounded-[6px] border border-mg-border-subtle px-[8px] py-[5px]">
      <div className="flex items-center gap-[8px] text-[11px]">
        <input type="checkbox" checked={selectable && checked} disabled={!selectable} onChange={onToggle} aria-label={`Importar ${candidate.name} de ${candidate.originLabel}`} />
        <span className="font-medium text-mg-body">{candidate.name}</span>
        <span className="text-[10px] text-mg-ter">{candidate.originLabel}</span>
        <span className="ml-auto rounded-[4px] bg-mg-hover px-[5px] py-[1px] text-[9px] font-semibold text-mg-body2">{STATUS_LABELS[candidate.status]}</span>
      </div>
      {candidate.status === 'different' && selectable && (
        <label className="ml-[22px] flex items-center gap-[5px] text-[10px] text-mg-sec">
          <input type="checkbox" checked={replace} onChange={onToggleReplace} aria-label={`Sustituir el común ${candidate.name}`} />
          Sustituir el común actual (si no, se queda el que hay)
        </label>
      )}
      {candidate.note !== null && (
        <span className="ml-[22px] text-[10px] text-mg-sec">{candidate.note}</span>
      )}
    </li>
  );
}

function ImportDone({ notes, count, onClose }: { readonly notes: readonly string[]; readonly count: number; readonly onClose: () => void }): React.JSX.Element {
  return (
    <div role="status" className="flex flex-col gap-[6px] text-[11px] text-mg-body2">
      <span>Importación hecha ({count}).</span>
      {notes.map((note) => (
        <span key={note} className="text-[10.5px] text-mg-sec">
          {note}
        </span>
      ))}
      <div className="flex justify-end">
        <button onClick={onClose} className={MCP_PRIMARY_BUTTON_CLASS}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
