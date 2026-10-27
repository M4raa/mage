import { useEffect, useRef, useState } from 'react';
import {
  isRemoteTransport,
  validateServerDraft,
  type McpInventoryRow,
  type McpKeyValueDraft,
  type McpRevealedSecrets,
  type McpServerDraft,
  type McpTransport,
} from '@shared/mcp';
import { useMcpStore } from '../../mcpStore';
import { Icon } from '../Icon';
import { MCP_BUTTON_CLASS as BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';
import { useT } from '../../../i18n/uiLanguage';

// Editor de UN servidor comun, en dialogo y por tipo (P-028 punto 5): local = comando, argumentos y
// variables; remoto = URL y cabeceras. Los valores guardados de env/headers llegan ENMASCARADOS
// (`value: null`): se conservan si no se tocan, se sustituyen si se escribe uno, y solo se ven tras
// «Mostrar», que es la unica llamada que trae valores al renderer.

const INPUT_CLASS =
  'w-full min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] font-mono text-[11px] text-mg-body outline-none focus:border-mg-border-emph';
// La etiqueta es la CLAVE del catalogo: se traduce al pintar.
const TRANSPORTS = [
  { id: 'stdio', label: 'mcp.serverDialog.transport.stdio' },
  { id: 'http', label: 'mcp.serverDialog.transport.http' },
  { id: 'sse', label: 'mcp.serverDialog.transport.sse' },
] as const satisfies readonly { readonly id: McpTransport; readonly label: string }[];

function draftFromRow(row: McpInventoryRow | null): McpServerDraft {
  const common = row?.common ?? null;
  return {
    name: row?.name ?? '',
    transport: common?.transport ?? 'stdio',
    command: common?.command ?? '',
    argsText: (common?.args ?? []).join('\n'),
    url: common?.url ?? '',
    env: (row?.envKeys ?? []).map((key) => ({ key, value: null })),
    headers: (row?.headerKeys ?? []).map((key) => ({ key, value: null })),
  };
}

function withRevealed(entries: readonly McpKeyValueDraft[], values: Readonly<Record<string, string>>): readonly McpKeyValueDraft[] {
  return entries.map((entry) => (entry.value === null && entry.key in values ? { ...entry, value: values[entry.key] ?? null } : entry));
}

export function McpServerDialog({ row, onClose }: { readonly row: McpInventoryRow | null; readonly onClose: () => void }): React.JSX.Element {
  const mutate = useMcpStore((s) => s.mutate);
  const [draft, setDraft] = useState<McpServerDraft>(() => draftFromRow(row));
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement | null>(null);
  const t = useT();
  useEffect(() => firstInput.current?.focus(), []);

  const patch = (changes: Partial<McpServerDraft>): void => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  };
  const reveal = (): void => {
    if (row === null) return;
    window.mage
      .revealMcpCommon(row.name)
      .then((secrets: McpRevealedSecrets) => {
        setDraft((current) => ({ ...current, env: withRevealed(current.env, secrets.env), headers: withRevealed(current.headers, secrets.headers) }));
        setRevealed(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const save = (): void => {
    const problem = validateServerDraft(draft);
    if (problem !== null) return setError(problem);
    setBusy(true);
    mutate({ op: 'upsert', originalName: row?.name ?? null, draft })
      .then((result) => (result.status === 'saved' ? onClose() : setError(result.message)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  const remote = isRemoteTransport(draft.transport);
  const hasMasked = [...draft.env, ...draft.headers].some((entry) => entry.value === null);

  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-server-dialog-title"
        data-mcp-server-dialog="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={stopEscape(onClose)}
        className={MCP_DIALOG_PANEL_CLASS}
      >
        <div id="mcp-server-dialog-title" className="text-[12.5px] font-bold text-mg-text">
          {row === null ? t('mcp.serverDialog.addTitle') : t('mcp.serverDialog.editTitle', { name: row.name })}
        </div>
        <div role="radiogroup" aria-label={t('mcp.serverDialog.transportAria')} className="flex gap-[4px]">
          {TRANSPORTS.map((transport) => (
            <button
              key={transport.id}
              role="radio"
              aria-checked={draft.transport === transport.id}
              onClick={() => patch({ transport: transport.id })}
              className={`rounded-[6px] border px-[9px] py-[3px] text-[10.5px] ${draft.transport === transport.id ? 'border-mg-focus bg-mg-sel text-mg-body' : 'border-mg-border-subtle text-mg-body2 hover:bg-mg-hover'}`}
            >
              {t(transport.label)}
            </button>
          ))}
        </div>
        <Labeled label={t('mcp.serverDialog.name')}>
          <input ref={firstInput} value={draft.name} onChange={(e) => patch({ name: e.target.value })} aria-label={t('mcp.serverDialog.nameAria')} className={INPUT_CLASS} />
        </Labeled>
        {remote ? (
          <Labeled label="URL">
            <input value={draft.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…/mcp" aria-label={t('mcp.serverDialog.urlAria')} className={INPUT_CLASS} />
          </Labeled>
        ) : (
          <>
            <Labeled label={t('mcp.serverDialog.command')}>
              <input value={draft.command} onChange={(e) => patch({ command: e.target.value })} placeholder="npx, node, uvx…" aria-label={t('mcp.serverDialog.commandAria')} className={INPUT_CLASS} />
            </Labeled>
            <Labeled label={t('mcp.serverDialog.args')}>
              <textarea value={draft.argsText} onChange={(e) => patch({ argsText: e.target.value })} rows={3} spellCheck={false} aria-label={t('mcp.serverDialog.argsAria')} className={`${INPUT_CLASS} resize-y`} />
            </Labeled>
          </>
        )}
        <KeyValueEditor
          title={remote ? t('mcp.serverDialog.headers') : t('mcp.serverDialog.env')}
          entries={remote ? draft.headers : draft.env}
          revealed={revealed}
          onChange={(entries) => patch(remote ? { headers: entries } : { env: entries })}
        />
        {error !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-[8px]">
          {row !== null && hasMasked && (
            <button onClick={reveal} className={`${BUTTON_CLASS} mr-auto`}>
              <Icon name="eye" />
              {t('mcp.serverDialog.reveal')}
            </button>
          )}
          <button onClick={onClose} className={BUTTON_CLASS}>
            {t('mcp.common.cancel')}
          </button>
          <button onClick={save} disabled={busy} className={MCP_PRIMARY_BUTTON_CLASS}>
            {busy ? t('mcp.serverDialog.saving') : t('mcp.common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-[9.5px] uppercase tracking-[.06em] text-mg-ter">{label}</span>
      {children}
    </label>
  );
}

// Una fila por clave. Un valor guardado sin revelar se ve vacio con «(guardado)»; escribir lo sustituye.
function KeyValueEditor({
  title,
  entries,
  revealed,
  onChange,
}: {
  readonly title: string;
  readonly entries: readonly McpKeyValueDraft[];
  readonly revealed: boolean;
  readonly onChange: (entries: readonly McpKeyValueDraft[]) => void;
}): React.JSX.Element {
  const t = useT();
  const update = (index: number, change: Partial<McpKeyValueDraft>): void => onChange(entries.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  return (
    <div className="flex flex-col gap-[4px]" data-mcp-kv={title}>
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] uppercase tracking-[.06em] text-mg-ter">{title}</span>
        <button onClick={() => onChange([...entries, { key: '', value: '' }])} className={BUTTON_CLASS}>
          <Icon name="plus" />
          {t('mcp.common.add')}
        </button>
      </div>
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-[6px]">
          <input value={entry.key} onChange={(e) => update(index, { key: e.target.value })} placeholder={t('mcp.serverDialog.keyPlaceholder')} aria-label={t('mcp.serverDialog.keyAria', { index: index + 1, title })} className={`${INPUT_CLASS} w-[38%] flex-none`} />
          <input
            type={revealed ? 'text' : 'password'}
            value={entry.value ?? ''}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder={entry.value === null ? t('mcp.common.maskedPlaceholder') : t('mcp.serverDialog.valuePlaceholder')}
            aria-label={t('mcp.serverDialog.valueAria', { index: index + 1, title })}
            autoComplete="off"
            className={INPUT_CLASS}
          />
          <button onClick={() => onChange(entries.filter((_, i) => i !== index))} aria-label={t('mcp.serverDialog.removeKeyAria', { index: index + 1, title })} className="rounded-[5px] p-[3px] text-mg-muted hover:bg-mg-hover">
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
