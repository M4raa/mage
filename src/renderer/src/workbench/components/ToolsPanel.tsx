import { useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { filterTools, groupToolsByOrigin } from '../toolsView';
import { Hint } from './TranscriptHint';

// Panel "Herramientas": lo que la sesion REALMENTE puede usar, agrupado por origen (nativas y luego un
// grupo por servidor MCP).
//
// El dato ya llegaba: el CLI manda la lista completa en el `session_init` y Mage se quedaba solo con el
// numero — que ademas no leia nadie. Es la misma clase de dato que el panel de MCP y el de comandos:
// la sesion es la unica fuente fiable de lo que se cargo de verdad, porque ni el modelo ni la
// configuracion en disco saben lo que acabo entrando.
const EMPTY: readonly string[] = [];

export function ToolsPanel(): React.JSX.Element {
  const tabId = usePaneTabId();
  const tools = useWorkbenchStore((s) => s.toolsByChat[tabId] ?? EMPTY);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => groupToolsByOrigin(filterTools(tools, query)), [tools, query]);

  // Sin cache en disco, al reves que el catalogo de comandos: las herramientas dependen de los
  // servidores MCP que arrancaran en ESTA sesion, asi que una lista de la sesion anterior podria
  // mentir. Antes de arrancar se dice que no se sabe, que es la verdad.
  if (tools.length === 0) {
    return <Hint text="Las herramientas se conocen al arrancar la sesión: se leen del propio agente, no de la configuración." />;
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-[8px] border-b border-mg-border-subtle p-[8px_10px]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar herramienta"
          placeholder="Buscar…"
          className="min-w-0 flex-1 rounded-[6px] border border-mg-border-ctrl bg-mg-code p-[4px_8px] text-[11px] text-mg-text placeholder:text-mg-muted"
        />
        <span className="flex-none text-[10px] text-mg-muted">{tools.length}</span>
      </div>
      <div className="flex min-h-0 flex-col gap-[10px] overflow-y-auto p-[10px]">
        {groups.length === 0 ? (
          <div className="text-[11px] text-mg-muted">Ninguna herramienta casa con «{query}».</div>
        ) : (
          groups.map((group) => (
            <section key={group.origin} className="flex flex-col gap-[2px]">
              <div className="text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">
                {group.origin} ({group.tools.length})
              </div>
              {group.tools.map((tool) => (
                // `title` con el nombre COMPLETO: dentro de un grupo de MCP se pinta el corto, y el
                // largo es el que hace falta para una regla de permisos o un `--allowedTools`.
                <div key={tool.name} title={tool.name} className="rounded-[6px] p-[3px_6px] font-mono text-[11px] text-mg-body hover:bg-mg-hover">
                  {tool.label}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
