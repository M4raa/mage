import { useEffect, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { Markdown } from './Markdown';
import { Hint } from './TranscriptHint';
import type { InstructionsFile } from '@shared/ipc';
import { AGY_PROVIDER_ID } from '@shared/providers';

// Panel "Instrucciones" (2.9.b): el `CLAUDE.md` del PROYECTO y el del USUARIO, que son las
// instrucciones que el CLI aplica de verdad a esta conversacion.
//
// Es un PANEL y no una seccion de Configuracion porque es **por proyecto y por cuenta** (cambia al
// cambiar de pestaña), igual que Memoria y MCP; una seccion de Configuracion es global y modal.
//
// Ojo con una afirmacion que circulaba: Mage NO leia `CLAUDE.md` en ningun sitio — lo lee el CLI. Esta
// vista es fontaneria nueva (servicio + IPC + panel), no exponer algo que ya existiera.
//
// En una pestaña de codex o agy (grupo H) son los CLAUDE.md que Mage le PUENTEA como su AGENTS.md o
// GEMINI.md, y cada uno dice si se le pasa o si el CLI usa el suyo.
const SCOPE_LABEL: Readonly<Record<InstructionsFile['scope'], string>> = {
  project: 'Proyecto',
  user: 'Usuario',
};

export function InstructionsPanel(): React.JSX.Element {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const cwd = tab?.cwd;
  const accountDir = tab === undefined ? undefined : (tab.resolvedConfigDir ?? tab.accountId);
  const provider = tab?.provider;
  const [files, setFiles] = useState<readonly InstructionsFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cwd === undefined || accountDir === undefined) return;
    let cancelled = false;
    setFiles(null);
    setError(null);
    void window.mage
      .readInstructions({ cwd, accountDir, ...(provider === undefined ? {} : { provider }) })
      .then((result) => {
        if (!cancelled) setFiles(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, accountDir, provider]);

  if (tab === undefined) return <Hint text="Abre una conversación para ver sus instrucciones." />;
  if (error !== null) {
    return (
      <div role="alert" className="p-[14px] text-[11.5px] text-mg-danger">
        {error}
      </div>
    );
  }
  if (files === null) return <Hint text="Cargando instrucciones…" />;

  return (
    <div className="flex min-h-0 flex-col gap-[12px] overflow-y-auto p-[12px_14px]">
      {files.map((file) => (
        <section key={file.scope} data-instructions-scope={file.scope} className="flex flex-col gap-[6px]">
          <header className="flex items-baseline gap-[8px]">
            <span className="text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">{SCOPE_LABEL[file.scope]}</span>
            <span className="truncate font-mono text-[10px] text-mg-muted" title={file.path}>
              {file.path}
            </span>
            {file.content !== null && (
              <button
                onClick={() => void window.mage.openPath(file.path).catch(() => undefined)}
                className="ml-auto flex-none rounded-[5px] border border-mg-border-ctrl px-[7px] py-[1px] text-[10px] text-mg-body2 hover:bg-mg-hover"
              >
                Abrir
              </button>
            )}
          </header>
          {file.bridge !== undefined && file.content !== null && <BridgeNote bridge={file.bridge} provider={provider ?? ''} />}
          {file.content === null ? (
            // Ausente NO es un error: la mayoria de los proyectos no tienen CLAUDE.md.
            <div className="text-[11px] text-mg-muted">No hay fichero.</div>
          ) : file.content.trim().length === 0 ? (
            <div className="text-[11px] text-mg-muted">El fichero existe pero está vacío.</div>
          ) : (
            <div className="text-[11.5px] leading-[1.55] text-mg-body">
              <Markdown text={file.content} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// Una linea por fichero en codex/agy: si esta conversacion lo recibe como instrucciones y como que.
function BridgeNote({ bridge, provider }: { readonly bridge: NonNullable<InstructionsFile['bridge']>; readonly provider: string }): React.JSX.Element {
  const cli = provider === AGY_PROVIDER_ID ? 'agy' : 'Codex';
  if (bridge.ownFile !== null) {
    return (
      <div className="text-[10.5px] text-mg-muted" title={bridge.ownFile}>
        No se le pasa: {cli} usa su propio fichero de instrucciones.
      </div>
    );
  }
  return (
    <div data-instructions-bridge={bridge.target} className="text-[10.5px] text-mg-sec">
      Esta conversación usa este CLAUDE.md como instrucciones: Mage se lo pasa a {cli} como {bridge.target}, sin escribir en el repo.
    </div>
  );
}
