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

// Editor de UN servidor comun, en dialogo y por tipo (P-028 punto 5): local = comando, argumentos y
// variables; remoto = URL y cabeceras. Los valores guardados de env/headers llegan ENMASCARADOS
// (`value: null`): se conservan si no se tocan, se sustituyen si se escribe uno, y solo se ven tras
// «Mostrar», que es la unica llamada que trae valores al renderer.

const INPUT_CLASS =
  'w-full min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] font-mono text-[11px] text-mg-body outline-none focus:border-mg-border-emph';
const TRANSPORTS: readonly { readonly id: McpTransport; readonly label: string }[] = [
  { id: 'stdio', label: 'Local (comando)' },
  { id: 'http', label: 'Remoto HTTP' },
  { id: 'sse', label: 'Remoto SSE' },
];
const MASKED_PLACEHOLDER = '•••••• (guardado)';

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
          {row === null ? 'Añadir servidor común' : `Editar ${row.name}`}
        </div>
        <div role="radiogroup" aria-label="Tipo de servidor" className="flex gap-[4px]">
          {TRANSPORTS.map((transport) => (
            <button
              key={transport.id}
              role="radio"
              aria-checked={draft.transport === transport.id}
              onClick={() => patch({ transport: transport.id })}
              className={`rounded-[6px] border px-[9px] py-[3px] text-[10.5px] ${draft.transport === transport.id ? 'border-mg-focus bg-mg-sel text-mg-body' : 'border-mg-border-subtle text-mg-body2 hover:bg-mg-hover'}`}
            >
              {transport.label}
            </button>
          ))}
        </div>
        <Labeled label="Nombre">
          <input ref={firstInput} value={draft.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Nombre del servidor" className={INPUT_CLASS} />
        </Labeled>
        {remote ? (
          <Labeled label="URL">
            <input value={draft.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…/mcp" aria-label="URL del servidor" className={INPUT_CLASS} />
          </Labeled>
        ) : (
          <>
            <Labeled label="Comando">
              <input value={draft.command} onChange={(e) => patch({ command: e.target.value })} placeholder="npx, node, uvx…" aria-label="Comando del servidor" className={INPUT_CLASS} />
            </Labeled>
            <Labeled label="Argumentos (uno por línea)">
              <textarea value={draft.argsText} onChange={(e) => patch({ argsText: e.target.value })} rows={3} spellCheck={false} aria-label="Argumentos del servidor" className={`${INPUT_CLASS} resize-y`} />
            </Labeled>
          </>
        )}
        <KeyValueEditor
          title={remote ? 'Cabeceras' : 'Variables de entorno'}
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
              Mostrar valores
            </button>
          )}
          <button onClick={onClose} className={BUTTON_CLASS}>
            Cancelar
          </button>
          <button onClick={save} disabled={busy} className={MCP_PRIMARY_BUTTON_CLASS}>
            {busy ? 'Guardando…' : 'Guardar'}
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
  const update = (index: number, change: Partial<McpKeyValueDraft>): void => onChange(entries.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  return (
    <div className="flex flex-col gap-[4px]" data-mcp-kv={title}>
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] uppercase tracking-[.06em] text-mg-ter">{title}</span>
        <button onClick={() => onChange([...entries, { key: '', value: '' }])} className={BUTTON_CLASS}>
          <Icon name="plus" />
          Añadir
        </button>
      </div>
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-[6px]">
          <input value={entry.key} onChange={(e) => update(index, { key: e.target.value })} placeholder="CLAVE" aria-label={`Clave ${index + 1} de ${title}`} className={`${INPUT_CLASS} w-[38%] flex-none`} />
          <input
            type={revealed ? 'text' : 'password'}
            value={entry.value ?? ''}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder={entry.value === null ? MASKED_PLACEHOLDER : 'valor'}
            aria-label={`Valor ${index + 1} de ${title}`}
            autoComplete="off"
            className={INPUT_CLASS}
          />
          <button onClick={() => onChange(entries.filter((_, i) => i !== index))} aria-label={`Quitar clave ${index + 1} de ${title}`} className="rounded-[5px] p-[3px] text-mg-muted hover:bg-mg-hover">
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
