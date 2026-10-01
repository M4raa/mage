import { useEffect, useState } from 'react';
import type { McpAgyChange, McpAgySyncPreview } from '@shared/mcp';
import { useMcpStore } from '../../mcpStore';
import { Icon } from '../Icon';
import { MCP_BUTTON_CLASS as BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';

// «Sincronizar con agy» (C3-j): agy no carga nada por sesion, asi que los comunes y las extensiones se
// le EXPORTAN a su mcp_config.json. Mage solo toca lo que exporto, hace copia antes y enseña el cambio
// antes de escribir. Con la sincronizacion automatica, se hace sola tras cada cambio de Mage.

const ACTION_LABELS: Readonly<Record<McpAgyChange['action'], string>> = {
  add: 'Se añade',
  update: 'Se actualiza',
  remove: 'Se quita',
  skip: 'No se toca',
};

export function McpAgySyncPanel(): React.JSX.Element {
  const agy = useMcpStore((s) => s.agy);
  const loadAgy = useMcpStore((s) => s.loadAgy);
  const previewAgy = useMcpStore((s) => s.previewAgy);
  const setAgyAuto = useMcpStore((s) => s.setAgyAuto);
  const [preview, setPreview] = useState<McpAgySyncPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void loadAgy().catch((err: unknown) => setError(describe(err))), [loadAgy]);
  const open = (): void => {
    setError(null);
    previewAgy()
      .then(setPreview)
      .catch((err: unknown) => setError(describe(err)));
  };
  return (
    <div data-mcp-agy-sync="true" className="flex flex-col gap-[5px] rounded-[7px] border border-mg-border-subtle bg-mg-code p-[8px_10px] text-[10.5px] text-mg-sec">
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1">
          <strong className="text-mg-body">agy</strong> no carga MCP por sesión: Mage le copia los comunes y las extensiones en su{' '}
          <code>mcp_config.json</code>, sin tocar lo que ya tenía. Los valores de los comunes quedan en claro en ese fichero, como con{' '}
          <code>agy mcp add</code>; los de la bóveda (extensiones) solo si lo confirmas al sincronizar.
        </span>
        <button onClick={open} className={BUTTON_CLASS}>
          <Icon name="refresh" />
          Sincronizar con agy
        </button>
      </div>
      <label className="flex items-center gap-[6px] text-mg-body2">
        <input type="checkbox" checked={agy?.auto ?? false} disabled={agy === null} onChange={(e) => void setAgyAuto(e.target.checked).catch((err: unknown) => setError(describe(err)))} />
        Sincronizar automáticamente tras cada cambio
      </label>
      {agy?.lastSyncAt != null && <span>Última sincronización: {new Date(agy.lastSyncAt).toLocaleString()}</span>}
      {(error ?? agy?.lastError ?? null) !== null && (
        <span role="alert" className="text-mg-danger">
          {error ?? agy?.lastError}
        </span>
      )}
      {preview !== null && <AgySyncDialog preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AgySyncDialog({ preview: initial, onClose }: { readonly preview: McpAgySyncPreview; readonly onClose: () => void }): React.JSX.Element {
  const applyAgy = useMcpStore((s) => s.applyAgy);
  const previewAgy = useMcpStore((s) => s.previewAgy);
  const [preview, setPreview] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const writes = preview.changes.some((change) => change.action !== 'skip');
  // Marcar o desmarcar un servidor con valores de la boveda rehace la vista previa: el usuario ve
  // exactamente lo que se escribira.
  const toggleSecret = (name: string, checked: boolean): void => {
    const next = checked ? [...preview.secretsConfirmed, name] : preview.secretsConfirmed.filter((item) => item !== name);
    previewAgy(next)
      .then(setPreview)
      .catch((err: unknown) => setMessage(describe(err)));
  };
  const apply = (): void => {
    applyAgy(preview.expected, preview.secretsConfirmed)
      .then((result) => (result.status === 'saved' ? onClose() : setMessage(result.message)))
      .catch((err: unknown) => setMessage(describe(err)));
  };
  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Sincronizar con agy" data-mcp-agy-dialog="true" onClick={(e) => e.stopPropagation()} onKeyDown={stopEscape(onClose)} className={MCP_DIALOG_PANEL_CLASS}>
        <div className="text-[12.5px] font-bold text-mg-text">Sincronizar con agy</div>
        <code className="text-[10px] text-mg-sec">{preview.path}</code>
        {preview.changes.length === 0 ? (
          <p className="text-[11px] text-mg-sec">agy ya tiene lo mismo que Mage: no hay nada que cambiar.</p>
        ) : (
          <ul className="flex flex-col gap-[3px] text-[11px]">
            {preview.changes.map((change) => (
              <li key={`${change.action}:${change.name}`} data-mcp-agy-change={change.action}>
                <strong className="text-mg-body">{ACTION_LABELS[change.action]}</strong> {change.name}
                {change.reason !== null && <span className="text-mg-sec"> — {change.reason}</span>}
              </li>
            ))}
          </ul>
        )}
        {preview.secretServers.length > 0 && (
          <div data-mcp-agy-secrets="true" className="flex flex-col gap-[3px] rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[7px_10px] text-[10.5px] text-mg-warn-text">
            <span>
              Estas extensiones llevan valores guardados cifrados en la bóveda de Mage. agy no tiene forma de recibirlos sin
              fichero: si las copias, esos valores quedarán <strong>en claro</strong> en su mcp_config.json.
            </span>
            {preview.secretServers.map((name) => (
              <label key={name} className="flex items-center gap-[6px]">
                <input
                  type="checkbox"
                  checked={preview.secretsConfirmed.includes(name)}
                  onChange={(e) => toggleSecret(name, e.target.checked)}
                  aria-label={`Copiar a agy los valores sensibles de ${name}`}
                />
                Copiar también {name}
              </label>
            ))}
          </div>
        )}
        {writes && <p className="text-[10px] text-mg-sec">Antes de escribir, Mage guarda una copia del fichero actual en su carpeta.</p>}
        {message !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {message}
          </div>
        )}
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={BUTTON_CLASS}>
            Cancelar
          </button>
          <button onClick={apply} disabled={!writes} className={MCP_PRIMARY_BUTTON_CLASS}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
