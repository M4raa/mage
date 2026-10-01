import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AGY_MCP_ANY_TOOL,
  agyMcpServerNames,
  parseAgyMcpRule,
  validateAgyCommand,
  validateAgyMcpTool,
  type AgyCommandRules,
  type AgyCommandVerdict,
} from '@shared/agyRules';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { DialogButton } from './CloseMageDialog';
import { Dropdown } from './Dropdown';
import { Icon } from './Icon';

// «Comandos de agy» (grupo E, fase 2): los comandos de terminal que agy puede ejecutar, por linea EXACTA.
// Se conceden o revocan al EMPEZAR la conversacion: agy lee sus reglas al arrancar (medido), asi que lo
// que se cambie aqui vale desde el primer mensaje de una conversacion nueva. Sin regex a proposito.
// Fase 3: tambien las herramientas MCP (`mcp(<servidor>/<tool>)`, con `*` para todas las del servidor).
export function AgyCommandsDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const rules = useWorkbenchStore((s) => s.settings.agyCommandRules);
  const setVerdict = useWorkbenchStore((s) => s.setAgyCommandVerdict);
  const dialogRef = useDialogA11y({ onClose });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (verdict: AgyCommandVerdict): void => {
    const checked = validateAgyCommand(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setVerdict(checked.command, verdict);
    setDraft('');
    setError(null);
  };
  const { commands, mcpTools } = splitRules(rules);

  return (
    <motion.div variants={MODAL_SCRIM_VARIANTS} initial="initial" animate="animate" exit="exit" className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={onClose}>
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agy-commands-title"
        data-agy-commands-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-32px)] w-[480px] max-w-[calc(100vw-32px)] flex-col gap-[12px] overflow-y-auto rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="agy-commands-title" className="text-[13px] font-bold text-mg-text">
          Comandos de agy
        </div>
        <p className="leading-[1.55] text-mg-body2">
          agy solo ejecuta los comandos de terminal que permitas aquí, escritos <strong>exactamente</strong> como los
          lanzará: <code>git status</code> no permite <code>git status --short</code>. Denegar gana a permitir. Se
          aplican al empezar la conversación.
        </p>
        <div className="flex flex-col gap-[12px]" data-agy-command-rules="true">
          <CommandList entries={commands} empty="Ningún comando todavía: agy los deniega todos." onVerdict={setVerdict} />
          <div className="flex items-center gap-[6px]">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add('allow');
              }}
              aria-label="Comando exacto"
              placeholder="p. ej. pnpm test"
              className="min-w-0 flex-1 rounded-[7px] border border-mg-border-ctrl bg-mg-window px-[8px] py-[5px] font-mono text-[11.5px] text-mg-text"
            />
            <DialogButton onClick={() => add('allow')}>Permitir</DialogButton>
            <DialogButton onClick={() => add('deny')}>Denegar</DialogButton>
          </div>
          {error !== null && (
            <div role="alert" className="text-[11px] text-mg-danger">
              {error}
            </div>
          )}
        </div>
        <McpToolRules entries={mcpTools} onVerdict={setVerdict} />
        <div className="flex justify-end">
          <DialogButton primary onClick={onClose}>
            Listo
          </DialogButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface RuleEntry {
  readonly rule: string; // lo que se guarda (comando exacto o `mcp(…)`)
  readonly label: string; // lo que se enseña
  readonly verdict: AgyCommandVerdict;
}

// Las reglas guardadas, separadas en comandos y herramientas MCP (comparten lista en los ajustes).
function splitRules(rules: AgyCommandRules): { readonly commands: readonly RuleEntry[]; readonly mcpTools: readonly RuleEntry[] } {
  const all = [...rules.allow.map((rule) => ({ rule, verdict: 'allow' as const })), ...rules.deny.map((rule) => ({ rule, verdict: 'deny' as const }))];
  const commands: RuleEntry[] = [];
  const mcpTools: RuleEntry[] = [];
  for (const entry of all) {
    const mcp = parseAgyMcpRule(entry.rule);
    if (mcp === null) commands.push({ ...entry, label: entry.rule });
    else mcpTools.push({ ...entry, label: mcp.tool === AGY_MCP_ANY_TOOL ? `${mcp.server} · todas` : `${mcp.server}/${mcp.tool}` });
  }
  return { commands, mcpTools };
}

// Servidores MCP que carga agy (su mcp_config.json y lo exportado por Mage), para elegir. Se piden al
// abrir el dialogo: el inventario lo lee main y no cambia mientras esta abierto.
function useAgyMcpServers(): { readonly servers: readonly string[] | null; readonly loadError: string | null } {
  const [servers, setServers] = useState<readonly string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.mage
      .loadMcpInventory({ projectDirs: [] })
      .then((inventory) => alive && setServers(agyMcpServerNames(inventory.rows)))
      .catch((err: unknown) => alive && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);
  return { servers, loadError };
}

function McpToolRules({ entries, onVerdict }: { readonly entries: readonly RuleEntry[]; readonly onVerdict: (rule: string, verdict: AgyCommandVerdict | null) => void }): React.JSX.Element {
  const { servers, loadError } = useAgyMcpServers();
  const [server, setServer] = useState('');
  const [tool, setTool] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chosen = server.length > 0 ? server : (servers?.[0] ?? '');

  const add = (verdict: AgyCommandVerdict): void => {
    const checked = validateAgyMcpTool(chosen, tool);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    onVerdict(checked.rule, verdict);
    setTool('');
    setError(null);
  };

  return (
    <div className="flex flex-col gap-[8px] border-t border-mg-border-subtle pt-[12px]" data-agy-mcp-rules="true">
      <div className="text-[12px] font-bold text-mg-text">Herramientas MCP</div>
      <p className="leading-[1.55] text-mg-body2">
        agy tampoco llama a una herramienta MCP sin permiso. Elige el servidor y escribe la herramienta exacta, o{' '}
        <code>{AGY_MCP_ANY_TOOL}</code> para todas las suyas.
      </p>
      <CommandList entries={entries} empty="Ninguna herramienta MCP todavía: agy las deniega todas." onVerdict={onVerdict} />
      {servers !== null && servers.length === 0 && (
        <div className="text-[11px] text-mg-muted">agy no carga ningún servidor MCP: añádelos en MCP y conectores y sincronízalos con agy.</div>
      )}
      {loadError !== null && (
        <div role="alert" className="text-[11px] text-mg-danger">
          No se pudieron leer los servidores MCP: {loadError}
        </div>
      )}
      {servers !== null && servers.length > 0 && (
        <div className="flex items-center gap-[6px]">
          <Dropdown
            value={chosen}
            options={servers.map((name) => ({ value: name, label: name }))}
            onChange={(value) => {
              setServer(value);
              setError(null);
            }}
            ariaLabel="Servidor MCP"
            triggerClassName="max-w-[150px]"
          />
          <input
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add('allow');
            }}
            aria-label="Herramienta MCP exacta"
            placeholder={`herramienta o ${AGY_MCP_ANY_TOOL}`}
            className="min-w-0 flex-1 rounded-[7px] border border-mg-border-ctrl bg-mg-window px-[8px] py-[5px] font-mono text-[11.5px] text-mg-text"
          />
          <DialogButton onClick={() => add('allow')}>Permitir</DialogButton>
          <DialogButton onClick={() => add('deny')}>Denegar</DialogButton>
        </div>
      )}
      {error !== null && (
        <div role="alert" className="text-[11px] text-mg-danger">
          {error}
        </div>
      )}
    </div>
  );
}

function CommandList({
  entries,
  empty,
  onVerdict,
}: {
  readonly entries: readonly RuleEntry[];
  readonly empty: string;
  readonly onVerdict: (rule: string, verdict: AgyCommandVerdict | null) => void;
}): React.JSX.Element {
  if (entries.length === 0) return <div className="text-[11px] text-mg-muted">{empty}</div>;
  return (
    <ul className="flex max-h-[220px] flex-col gap-[4px] overflow-y-auto" data-agy-command-list="true">
      {entries.map(({ rule, label, verdict }) => (
        <li key={`${verdict}:${rule}`} className="flex items-center gap-[8px] rounded-[7px] border border-mg-border-subtle bg-mg-code px-[8px] py-[4px]">
          <code className="min-w-0 flex-1 truncate text-[11.5px] text-mg-body">{label}</code>
          <button
            onClick={() => onVerdict(rule, verdict === 'allow' ? 'deny' : 'allow')}
            data-tip={verdict === 'allow' ? 'Pasar a denegado' : 'Pasar a permitido'}
            className={`shrink-0 rounded-[5px] border px-[6px] py-[1px] text-[10.5px] ${verdict === 'allow' ? 'border-mg-border-emph text-mg-body2' : 'border-mg-danger-border text-mg-danger'}`}
          >
            {verdict === 'allow' ? 'Permitido' : 'Denegado'}
          </button>
          <button onClick={() => onVerdict(rule, null)} aria-label={`Quitar ${label}`} className="shrink-0 text-mg-muted hover:text-mg-danger">
            <Icon name="trash" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
