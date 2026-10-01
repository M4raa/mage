import { useEffect, useRef, useState } from 'react';
import { MCP_FAMILY_LABELS, MCP_PROVIDER_FAMILIES, mcpScopeKey, type McpProviderFamily, type McpScope } from '@shared/mcp';
import { useWorkbenchStore } from '../../workbenchStore';
import { MCP_BUTTON_CLASS as BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';

// «Solo en…» de un comun o de una extension (respuestas 22 y 27, C3-n): una lista de proveedores y,
// en Claude, de cuentas. Por defecto, todos los compatibles. Es el control de acceso por modelo que
// tambien respetara el runtime propio.

export function ProviderPills({ providers, testId }: { readonly providers: readonly McpProviderFamily[]; readonly testId?: string }): React.JSX.Element {
  if (providers.length === 0) return <span className="text-mg-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-[3px]" data-mcp-providers={testId ?? 'true'}>
      {providers.map((family) => (
        <span key={family} className="rounded-[4px] bg-mg-hover px-[5px] py-[1px] text-[9px] font-semibold text-mg-body2">
          {MCP_FAMILY_LABELS[family]}
        </span>
      ))}
    </span>
  );
}

export function OwnedByBadge({ family }: { readonly family: McpProviderFamily }): React.JSX.Element {
  return <span className="rounded-[4px] bg-mg-code px-[5px] py-[1px] text-[9px] font-semibold text-mg-warn-text">Solo {MCP_FAMILY_LABELS[family]}</span>;
}

// Destinos que se ofrecen: cada familia y, debajo de Claude, cada cuenta.
function useTargets(): readonly { readonly key: string; readonly label: string; readonly indent: boolean }[] {
  const accounts = useWorkbenchStore((s) => s.accounts);
  return MCP_PROVIDER_FAMILIES.flatMap((family) => {
    const head = { key: mcpScopeKey(family), label: MCP_FAMILY_LABELS[family], indent: false };
    if (family !== 'claude') return [head];
    return [head, ...accounts.map((account) => ({ key: mcpScopeKey('claude', account.id), label: `Cuenta ${account.alias}`, indent: true }))];
  });
}

export function McpScopeDialog({
  title,
  scope,
  onSave,
  onClose,
}: {
  readonly title: string;
  readonly scope: McpScope;
  readonly onSave: (scope: McpScope) => Promise<void>;
  readonly onClose: () => void;
}): React.JSX.Element {
  const targets = useTargets();
  const [all, setAll] = useState(scope === null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(scope ?? []));
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => first.current?.focus(), []);
  const toggle = (key: string): void =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const save = (): void => {
    if (!all && picked.size === 0) return setError('Elige al menos un destino, o desactívalo.');
    onSave(all ? null : [...picked])
      .then(onClose)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} data-mcp-scope-dialog="true" onClick={(e) => e.stopPropagation()} onKeyDown={stopEscape(onClose)} className={MCP_DIALOG_PANEL_CLASS}>
        <div className="text-[12.5px] font-bold text-mg-text">{title}</div>
        <label className="flex items-center gap-[6px] text-[11px] text-mg-body">
          <input ref={first} type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          En todos los proveedores y cuentas compatibles
        </label>
        <fieldset disabled={all} className="flex flex-col gap-[4px] disabled:opacity-50">
          {targets.map((target) => (
            <label key={target.key} className={`flex items-center gap-[6px] text-[11px] text-mg-body2 ${target.indent ? 'pl-[20px]' : ''}`}>
              <input type="checkbox" checked={picked.has(target.key)} onChange={() => toggle(target.key)} aria-label={`Solo en ${target.label}`} />
              {target.label}
            </label>
          ))}
        </fieldset>
        <p className="text-[10px] text-mg-sec">
          A agy le llega una copia al sincronizar (no tiene forma de cargarlo por sesión). Codex lo recibe al abrir cada sesión.
        </p>
        {error !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={BUTTON_CLASS}>
            Cancelar
          </button>
          <button onClick={save} className={MCP_PRIMARY_BUTTON_CLASS}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
