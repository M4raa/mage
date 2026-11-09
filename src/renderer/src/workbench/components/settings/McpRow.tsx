import { useState } from 'react';
import { DELEGATION_DEPTH_MAX, DELEGATION_DEPTH_MIN } from '@shared/settings';
import type { McpTone } from '../../mcpView';
import { useLocalPopover } from '../../localPopovers';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';
import { useT } from '../../../i18n/uiLanguage';
import { useMcpRegistration } from './useMcpRegistration';
import { MCP_BUTTON_CLASS } from './mcpStyles';

// Piezas comunes de «MCP y conectores» (P-038 V12): las tres pestañas pintan sus filas igual —punto de estado, nombre,
// una línea de etiquetas del mismo tamaño, el estado y, a la derecha, la acción principal y un «⋯» con el resto—. Antes
// cada pestaña tenía su tabla o sus tarjetas, con etiquetas de colores y tamaños distintos y acciones solo con iconos.

export const TONE_DOT: Readonly<Record<McpTone, string>> = {
  ok: 'bg-mg-diff-add',
  attention: 'bg-mg-warn',
  error: 'bg-mg-danger',
  idle: 'bg-mg-muted',
};

export interface McpRowProps {
  readonly name: React.ReactNode;
  readonly meta: React.ReactNode;
  readonly status: React.ReactNode;
  readonly tone: McpTone;
  readonly actions?: React.ReactNode;
  readonly dataAttrs?: Readonly<Record<string, string>>;
}

export function McpRow({ name, meta, status, tone, actions, dataAttrs }: McpRowProps): React.JSX.Element {
  return (
    <div {...dataAttrs} className="grid grid-cols-[8px_minmax(0,1fr)_minmax(110px,170px)_auto] items-start gap-x-[10px] border-b border-mg-border-subtle py-[8px] text-[11px]">
      <span aria-hidden="true" data-mcp-tone={tone} className={`mt-[4px] h-[8px] w-[8px] rounded-full ${TONE_DOT[tone]}`} />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="truncate text-[11.5px] font-semibold text-mg-body">{name}</span>
        <div className="flex flex-wrap items-center gap-[4px]">{meta}</div>
      </div>
      <div className="min-w-0 text-[10.5px] text-mg-sec">{status}</div>
      <div className="flex items-start justify-end gap-[4px]">{actions}</div>
    </div>
  );
}

// Etiqueta de la línea de detalle: todas del mismo tamaño y neutras; `warn` solo para avisar (p. ej. «Solo Claude»).
export function MetaChip({ children, warn = false }: { readonly children: React.ReactNode; readonly warn?: boolean }): React.JSX.Element {
  const skin = warn ? 'border-mg-warn-border text-mg-warn-text' : 'border-mg-border-subtle text-mg-sec';
  return <span className={`rounded-[4px] border px-[5px] text-[10px] leading-[15px] ${skin}`}>{children}</span>;
}

export interface RowMenuItem {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

// «⋯» con las acciones secundarias de una fila. Los elementos conservan el nombre accesible que tenían como botones.
export function RowMenu({ label, items }: { readonly label: string; readonly items: readonly RowMenuItem[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  useLocalPopover(open);
  if (items.length === 0) return null;
  return (
    <span className="relative" onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={label} data-mcp-row-menu="true" className="grid h-[22px] w-[22px] place-items-center rounded-[5px] text-mg-muted hover:bg-mg-hover hover:text-mg-body">
        <Icon name="ellipsis" size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[40]" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-[24px] z-[41] min-w-[170px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11px] text-mg-body mg-shadow-pop">
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                aria-label={item.ariaLabel ?? item.label}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`block w-full px-[10px] py-[5px] text-left ${item.danger === true ? 'text-mg-danger hover:bg-mg-danger-bg' : 'hover:bg-mg-hover'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// Los textos que explican cómo funciona cada pestaña, plegados tras un «ⓘ» en vez de un muro de texto fijo.
export function InfoNote({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-[6px]">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} data-mcp-info="true" className="flex w-fit items-center gap-[5px] text-[10.5px] text-mg-sec hover:text-mg-body">
        <Icon name="info" size={12} />
        {t('mcp.info.howItWorks')}
      </button>
      {open && <div className="rounded-[7px] border border-mg-border-subtle bg-mg-code p-[8px_10px] text-[10.5px] leading-[1.5] text-mg-sec">{children}</div>}
    </div>
  );
}

const DEPTH_OPTIONS = Array.from({ length: DELEGATION_DEPTH_MAX - DELEGATION_DEPTH_MIN + 1 }, (_, index) => DELEGATION_DEPTH_MIN + index);
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex' } as const;

// El MCP de Mage, arriba de la sección (antes vivía al final de «Almacenamiento» y no se encontraba): el interruptor
// que decide si las conversaciones lo cargan y, plegado, la profundidad de delegación y el registro para la terminal.
export function MageMcpCard(): React.JSX.Element {
  const t = useT();
  const enabled = useWorkbenchStore((s) => s.settings.mageMcpEnabled);
  const setEnabled = useWorkbenchStore((s) => s.setMageMcpEnabled);
  const [advanced, setAdvanced] = useState(false);
  return (
    <section data-setting="mage-mcp-enabled" className="flex flex-col gap-[8px] rounded-[9px] border border-mg-border-emph bg-mg-panel p-[10px_12px]">
      <div className="flex items-start gap-[10px]">
        <Icon name="sparkles" className="mt-[1px] text-mg-focus" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[12px] font-semibold text-mg-text">{t('settings.sections.mcpServer.title')}</span>
          <span className="text-[10.5px] leading-[1.45] text-mg-sec">{t('settings.mcpServer.enabledHelp')}</span>
        </div>
        <label className="flex flex-none items-center gap-[6px] text-[11px] text-mg-body">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label={t('settings.mcpServer.enabledLabel')} />
          {enabled ? t('mcp.mage.on') : t('mcp.mage.off')}
        </label>
      </div>
      <button onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="flex w-fit items-center gap-[5px] text-[10.5px] text-mg-sec hover:text-mg-body">
        <Icon name="chevron" size={10} className={advanced ? 'rotate-90' : ''} />
        {t('mcp.mage.advanced')}
      </button>
      {advanced && <MageMcpAdvanced />}
    </section>
  );
}

function MageMcpAdvanced(): React.JSX.Element {
  const t = useT();
  const depth = useWorkbenchStore((s) => s.settings.delegation.maxDepth);
  const setDelegationDepth = useWorkbenchStore((s) => s.setDelegationDepth);
  const { result, busy, unavailable, register, unregister } = useMcpRegistration();
  const accountNames = new Map((result?.entries ?? []).map((entry) => [entry.accountId, entry.accountName]));
  return (
    <div className="flex flex-col gap-[10px] border-t border-mg-border-subtle pt-[8px] text-[11px] text-mg-body">
      <label className="flex items-center gap-[8px]">
        <select className="w-[60px] rounded-[4px] border border-mg-border bg-transparent px-[6px] py-[2px] text-[11px]" value={depth} onChange={(e) => setDelegationDepth(Number(e.target.value))}>
          {DEPTH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <span>
          <span className="font-semibold">{t('settings.mcpServer.depthLabel')}</span>
          <span className="block text-[10.5px] text-mg-ter">{t('settings.mcpServer.depthHelp')}</span>
        </span>
      </label>
      <div className="flex flex-col gap-[4px]">
        <span className="font-semibold">{t('mcp.mage.terminalTitle')}</span>
        <span className="text-[10.5px] text-mg-ter">{t('mcp.mage.terminalHelp')}</span>
        <ul role="status" className="flex flex-col gap-[2px] text-[10.5px] text-mg-sec">
          {unavailable && <li>{t('settings.mcpServer.statusUnavailable')}</li>}
          {result?.entries.map((entry) => (
            <li key={entry.accountId}>{entry.accountName} ({PROVIDER_LABEL[entry.provider]}): {t(entry.registered ? 'settings.mcpServer.registered' : 'settings.mcpServer.notRegistered')}</li>
          ))}
          {result?.failures.map((failure) => (
            <li key={failure.accountId} className="text-mg-danger">{t('settings.mcpServer.failed', { account: accountNames.get(failure.accountId) ?? failure.accountId, detail: failure.message })}</li>
          ))}
        </ul>
        <div className="flex gap-[8px]">
          <button type="button" className={MCP_BUTTON_CLASS} disabled={busy} onClick={register}>{t('settings.mcpServer.registerAll')}</button>
          <button type="button" className={MCP_BUTTON_CLASS} disabled={busy} onClick={unregister}>{t('settings.mcpServer.unregisterAll')}</button>
        </div>
      </div>
    </div>
  );
}
