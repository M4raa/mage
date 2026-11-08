import { useEffect, useMemo, useState } from 'react';
import { renderLocalized } from '@shared/i18n/localizedText';
import type { McpImportCandidate, McpImportGroup, McpImportPreview, McpImportStatus } from '@shared/mcp';
import { useMcpStore } from '../../mcpStore';
import { MCP_BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';
import { useT } from '../../../i18n/uiLanguage';
import { describeError } from '../../describeError';

// «Importar…» con vista previa (P-028 punto 34). Origen elegible: Claude Desktop, Claude Code CLI o los
// dos. Cada fila dice si es nueva, si ya esta igual o si existe con otra configuracion (en ese caso se
// queda la actual salvo que se marque «sustituir»). El original nunca se toca. El renderer solo ve
// nombres y metadatos: al aplicar manda ids y main relee las fuentes.

type GroupFilter = 'all' | McpImportGroup;

// `product` es un nombre de producto (no se traduce); null = «Los dos», que sale del catalogo al pintar.
const FILTERS: readonly { readonly id: GroupFilter; readonly product: string | null }[] = [
  { id: 'all', product: null },
  { id: 'desktop', product: 'Claude Desktop' },
  { id: 'cli', product: 'Claude Code CLI' },
];
const STATUS_LABELS = {
  new: 'mcp.import.status.new',
  same: 'mcp.import.status.same',
  different: 'mcp.import.status.different',
} as const satisfies Readonly<Record<McpImportStatus, string>>;

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
  const t = useT();

  useEffect(() => {
    previewImport()
      .then((result) => {
        setPreview(result);
        setSelection(initialSelection(result.candidates));
      })
      .catch((err: unknown) => setError(err instanceof Error ? describeError(err) : String(err)));
  }, []);

  const visible = useMemo(() => (preview?.candidates ?? []).filter((c) => filter === 'all' || c.group === filter), [preview, filter]);
  const picks = visible.filter((c) => isSelectable(c) && selection.checked.has(c.id)).map((c) => ({ id: c.id, replace: selection.replace.has(c.id) }));

  const apply = (): void => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    applyImport(picks, preview.commonVersion)
      .then((result) => (result.status === 'saved' ? setNotes(result.notes.map((note) => renderLocalized(t, note))) : setError(renderLocalized(t, result.message))))
      .catch((err: unknown) => setError(err instanceof Error ? describeError(err) : String(err)))
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
          {t('mcp.import.title')}
        </div>
        <p className="text-[10.5px] leading-[1.5] text-mg-sec">
          {t('mcp.import.intro.start')} <code>mcp-common.json</code> {t('mcp.import.intro.end')}
        </p>
        {notes !== null ? (
          <ImportDone notes={notes} count={picks.length} onClose={onClose} />
        ) : (
          <>
            <div role="radiogroup" aria-label={t('mcp.import.originAria')} className="flex gap-[4px]">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={`rounded-[6px] border px-[9px] py-[3px] text-[10.5px] ${filter === option.id ? 'border-mg-focus bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'border-mg-border-subtle text-mg-body2 hover:bg-mg-hover'}`}
                >
                  {option.product ?? t('mcp.import.filter.both')}
                </button>
              ))}
            </div>
            {preview === null && error === null && <p className="text-[11px] text-mg-muted">{t('mcp.import.loading')}</p>}
            {preview !== null && visible.length === 0 && <p className="text-[11px] text-mg-muted">{t('mcp.import.empty')}</p>}
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
                {t('mcp.common.cancel')}
              </button>
              <button onClick={apply} disabled={busy || picks.length === 0} className={MCP_PRIMARY_BUTTON_CLASS}>
                {busy ? t('mcp.import.running') : t('mcp.import.apply', { count: picks.length })}
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
  const t = useT();
  return (
    <li data-mcp-candidate={candidate.name} className="flex flex-col gap-[2px] rounded-[6px] border border-mg-border-subtle px-[8px] py-[5px]">
      <div className="flex items-center gap-[8px] text-[11px]">
        <input type="checkbox" checked={selectable && checked} disabled={!selectable} onChange={onToggle} aria-label={t('mcp.import.candidateAria', { name: candidate.name, origin: renderLocalized(t, candidate.originLabel) })} />
        <span className="font-medium text-mg-body">{candidate.name}</span>
        <span className="text-[10px] text-mg-ter">{renderLocalized(t, candidate.originLabel)}</span>
        <span className="ml-auto rounded-[4px] bg-mg-hover px-[5px] py-[1px] text-[9px] font-semibold text-mg-body2">{t(STATUS_LABELS[candidate.status])}</span>
      </div>
      {candidate.status === 'different' && selectable && (
        <label className="ml-[22px] flex items-center gap-[5px] text-[10px] text-mg-sec">
          <input type="checkbox" checked={replace} onChange={onToggleReplace} aria-label={t('mcp.import.replaceAria', { name: candidate.name })} />
          {t('mcp.import.replace')}
        </label>
      )}
      {candidate.note !== null && (
        <span className="ml-[22px] text-[10px] text-mg-sec">{renderLocalized(t, candidate.note)}</span>
      )}
    </li>
  );
}

function ImportDone({ notes, count, onClose }: { readonly notes: readonly string[]; readonly count: number; readonly onClose: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-[6px] text-[11px] text-mg-body2">
      <span>{t('mcp.import.done', { count })}</span>
      {notes.map((note) => (
        <span key={note} className="text-[10.5px] text-mg-sec">
          {note}
        </span>
      ))}
      <div className="flex justify-end">
        <button onClick={onClose} className={MCP_PRIMARY_BUTTON_CLASS}>
          {t('mcp.import.close')}
        </button>
      </div>
    </div>
  );
}
